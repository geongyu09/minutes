import http from 'node:http';
import { logger } from '@minutes/core';
import { config } from '@/config';
import { createRetriever } from '@/retrieval/retriever';
import { createVectorStore, countDocuments, deleteAllDocuments } from '@/retrieval/vectorStore';
import { clearLastSyncTime, getLastSyncTime } from '@/ingestion/syncState';
import { indexConnectionWithRefresh } from '@/ingestion/indexer';
import { getIndexJob, startIndexJob } from '@/ingestion/indexJobs';
import { db } from '@/db';
import { checkEmbedding } from '@/embedder';
import { findUserByAppToken, issueAppToken, revokeAppToken } from '@/auth/appTokens';
import { attachAppToken, claimAppToken, createLoginSession, hasLoginState } from '@/auth/loginSessions';
import { upsertUser, type User } from '@/auth/users';
import {
  addMember,
  createProject,
  deleteProject,
  getMembership,
  listMembers,
  listProjectsForUser,
  removeMember,
} from '@/projects/projects';
import { acceptInvite, createInvite, listInvites, revokeInvite } from '@/projects/invites';
import {
  cancelAuthorization,
  completeConnection,
  getConnectionByProject,
  hasOauthState,
  startConnection,
  type NotionConnection,
} from '@/oauth/connections';
import {
  buildAuthorizeUrl,
  buildLoginAuthorizeUrl,
  exchangeCode,
  exchangeCodeForIdentity,
} from '@/oauth/notionOauth';
import { handleHealth, handleIndex, handleIndexStatus, handleSearch } from './handlers';
import {
  bearerToken,
  handleAuthCallback,
  handleAuthSession,
  handleAuthStatus,
  handleLogout,
  handleMe,
} from './authHandlers';
import {
  handleAcceptInvite,
  handleCreateInvite,
  handleCreateProject,
  handleDeleteProject,
  handleGetProject,
  handleRemoveMember,
  handleRevokeInvite,
  requireMembership,
} from './projectHandlers';
import {
  handleOauthCallback,
  handleOauthCancel,
  handleOauthSession,
  handleOauthStatus,
} from './oauthHandlers';
import { createRateLimiter } from './rateLimit';

/** 연결 변경으로 워크스페이스가 바뀐 경우 — 이전 워크스페이스의 색인 데이터를 남기지 않는다. */
async function purgeIndexedData(connectionId: string): Promise<void> {
  await deleteAllDocuments(connectionId);
  await clearLastSyncTime(connectionId);
  logger.info(`연결 변경 — 이전 워크스페이스 색인 데이터 폐기 (${connectionId})`);
}

async function checkDb(): Promise<void> {
  db().prepare('SELECT count(*) FROM chunks').get();
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function respond(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function respondHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

// 인증 없이 열려 있는 로그인·인가 시작 엔드포인트 보호 (rules/security.md)
const authLimiter = createRateLimiter({
  limit: config.auth.rateLimitPerMinute,
  windowMs: config.auth.rateLimitWindowMs,
});

function callerKey(req: http.IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}

/** 경로 패턴(`/projects/:id/invites/:code`)을 맞춰보고 파라미터를 뽑는다. */
function match(pathname: string, pattern: string): Record<string, string> | null {
  const parts = pathname.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (parts.length !== patternParts.length) return null;

  const params: Record<string, string> = {};
  for (const [i, patternPart] of patternParts.entries()) {
    if (patternPart.startsWith(':')) params[patternPart.slice(1)] = decodeURIComponent(parts[i]);
    else if (patternPart !== parts[i]) return null;
  }
  return params;
}

/** Bearer 앱 토큰으로 요청 사용자를 식별한다. 없거나 모르는 토큰이면 null. */
function currentUser(req: http.IncomingMessage): User | null {
  const token = bearerToken(req.headers.authorization);
  return token ? findUserByAppToken(token) : null;
}

/**
 * 프로젝트 스코프 요청의 공통 관문 — 멤버십을 확인하고 프로젝트의 노션 연결을 찾는다.
 * 연결이 아직 없으면 색인 데이터도 없으므로 409로 안내한다.
 */
function resolveConnection(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string | undefined,
  options: { requireConnected?: boolean } = {}
): NotionConnection | null {
  const check = requireMembership(currentUser(req), projectId, getMembership);
  if (check.error) {
    respond(res, check.error.status, check.error.body);
    return null;
  }

  const connection = getConnectionByProject(projectId!);
  if (!connection) {
    respond(res, 409, { error: '이 프로젝트에 아직 노션이 연결되지 않았습니다.' });
    return null;
  }
  if (options.requireConnected && connection.status !== 'connected') {
    respond(res, 409, { error: '노션 연결이 완료되지 않았습니다.' });
    return null;
  }
  return connection;
}

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;
    const projectId = url.searchParams.get('projectId') ?? undefined;

    try {
      // ── 로그인 (노션 OAuth) ────────────────────────────────────────────────
      // 경로별로 따로 센다 — 로그인 폴링(/auth/notion/status)이 콜백의 예산을 소진하면 안 된다
      if (path.startsWith('/auth/') && !authLimiter.allow(`${callerKey(req)}:${path}`)) {
        respond(res, 429, { error: '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.' });
        return;
      }
      if (req.method === 'POST' && path === '/auth/notion/session') {
        const result = handleAuthSession({
          createSession: createLoginSession,
          buildAuthUrl: buildLoginAuthorizeUrl,
        });
        respond(res, result.status, result.body);
        return;
      }
      if (req.method === 'GET' && path === '/auth/notion/callback') {
        const result = await handleAuthCallback(
          {
            code: url.searchParams.get('code') ?? undefined,
            state: url.searchParams.get('state') ?? undefined,
            error: url.searchParams.get('error') ?? undefined,
          },
          {
            hasLoginState,
            exchangeIdentity: (code) => exchangeCodeForIdentity(code),
            upsertUser,
            issueAppToken,
            attachAppToken,
          }
        );
        if (result.status === 200) logger.info('노션 로그인 완료');
        respondHtml(res, result.status, result.html);
        return;
      }
      if (req.method === 'GET' && path === '/auth/notion/status') {
        const result = handleAuthStatus(bearerToken(req.headers.authorization), { claimAppToken });
        respond(res, result.status, result.body);
        return;
      }
      if (req.method === 'POST' && path === '/auth/logout') {
        const result = handleLogout(bearerToken(req.headers.authorization), { revokeAppToken });
        respond(res, result.status, result.body);
        return;
      }

      // ── 계정·프로젝트·초대 ────────────────────────────────────────────────
      if (req.method === 'GET' && path === '/me') {
        const result = handleMe(currentUser(req), { listProjects: listProjectsForUser });
        respond(res, result.status, result.body);
        return;
      }
      if (req.method === 'POST' && path === '/projects') {
        const result = handleCreateProject(currentUser(req), await readJson(req), { createProject });
        respond(res, result.status, result.body);
        return;
      }
      if (req.method === 'POST' && path === '/invites/accept') {
        const result = handleAcceptInvite(currentUser(req), await readJson(req), { acceptInvite });
        respond(res, result.status, result.body);
        return;
      }

      const inviteParams = match(path, '/projects/:id/invites/:code');
      if (req.method === 'DELETE' && inviteParams) {
        const result = handleRevokeInvite(currentUser(req), inviteParams.id, inviteParams.code, {
          getMembership,
          revokeInvite,
        });
        respond(res, result.status, result.body);
        return;
      }
      const invitesParams = match(path, '/projects/:id/invites');
      if (req.method === 'POST' && invitesParams) {
        const result = handleCreateInvite(currentUser(req), invitesParams.id, {
          getMembership,
          createInvite,
        });
        respond(res, result.status, result.body);
        return;
      }
      const memberParams = match(path, '/projects/:id/members/:userId');
      if (req.method === 'DELETE' && memberParams) {
        const result = handleRemoveMember(currentUser(req), memberParams.id, memberParams.userId, {
          getMembership,
          removeMember,
        });
        respond(res, result.status, result.body);
        return;
      }
      const projectParams = match(path, '/projects/:id');
      if (projectParams) {
        if (req.method === 'GET') {
          const result = handleGetProject(currentUser(req), projectParams.id, {
            getMembership,
            listMembers,
            listInvites,
          });
          respond(res, result.status, result.body);
          return;
        }
        if (req.method === 'DELETE') {
          const result = handleDeleteProject(currentUser(req), projectParams.id, {
            getMembership,
            deleteProject,
          });
          respond(res, result.status, result.body);
          return;
        }
      }

      // ── 프로젝트의 노션 연결 (색인용) ──────────────────────────────────────
      if (req.method === 'POST' && path === '/oauth/notion/session') {
        const result = handleOauthSession(currentUser(req), projectId, {
          getMembership,
          startConnection,
          buildAuthUrl: buildAuthorizeUrl,
        });
        respond(res, result.status, result.body);
        return;
      }
      if (req.method === 'GET' && path === '/oauth/notion/callback') {
        const result = await handleOauthCallback(
          {
            code: url.searchParams.get('code') ?? undefined,
            state: url.searchParams.get('state') ?? undefined,
            error: url.searchParams.get('error') ?? undefined,
          },
          {
            hasOauthState,
            exchange: exchangeCode,
            complete: completeConnection,
            purgeIndexedData,
          }
        );
        if (result.status === 200) logger.info('노션 워크스페이스 연결 완료');
        respondHtml(res, result.status, result.html);
        return;
      }
      if (req.method === 'POST' && path === '/oauth/notion/cancel') {
        const result = handleOauthCancel(currentUser(req), projectId, {
          getMembership,
          getConnection: getConnectionByProject,
          cancelAuthorization,
        });
        respond(res, result.status, result.body);
        return;
      }
      if (req.method === 'GET' && path === '/oauth/notion/status') {
        const result = handleOauthStatus(currentUser(req), projectId, {
          getMembership,
          getConnection: getConnectionByProject,
        });
        respond(res, result.status, result.body);
        return;
      }

      // ── 검색·색인 (프로젝트 스코프) ───────────────────────────────────────
      if (req.method === 'POST' && path === '/search') {
        const connection = resolveConnection(req, res, projectId);
        if (!connection) return;
        const result = await handleSearch(await readJson(req), createRetriever(connection.id));
        respond(res, result.status, result.body);
        return;
      }
      if (req.method === 'GET' && path === '/health') {
        const result = await handleHealth({ checkDb, checkEmbedding });
        respond(res, result.status, result.body);
        return;
      }
      if (req.method === 'GET' && path === '/status') {
        const connection = resolveConnection(req, res, projectId);
        if (!connection) return;
        respond(res, 200, {
          documentCount: await countDocuments(connection.id),
          chunkCount: await createVectorStore(connection.id).count(),
          lastSyncedAt: (await getLastSyncTime(connection.id)).toISOString(),
          workspaceName: connection.workspaceName,
        });
        return;
      }
      if (req.method === 'POST' && path === '/index') {
        // 색인은 노션 토큰이 필요하므로 owner(연결 수행자)만 시작할 수 있다
        const check = requireMembership(currentUser(req), projectId, getMembership, 'owner');
        if (check.error) {
          respond(res, check.error.status, check.error.body);
          return;
        }
        const connection = resolveConnection(req, res, projectId, { requireConnected: true });
        if (!connection) return;

        const mode = url.searchParams.get('mode') === 'full' ? 'full' : 'incremental';
        const result = await handleIndex(mode, {
          clearCursor: () => clearLastSyncTime(connection.id),
          start: () =>
            startIndexJob(connection.id, mode, (onProgress) =>
              indexConnectionWithRefresh(connection, mode, (p) => onProgress(p))
            ),
          getState: () => getIndexJob(connection.id),
        });
        respond(res, result.status, result.body);
        return;
      }
      if (req.method === 'GET' && path === '/index/status') {
        const connection = resolveConnection(req, res, projectId);
        if (!connection) return;
        const result = handleIndexStatus(() => getIndexJob(connection.id));
        respond(res, result.status, result.body);
        return;
      }
      respond(res, 404, { error: '알 수 없는 경로입니다' });
    } catch (err) {
      logger.error(`요청 처리 실패: ${req.method} ${path}`, String(err));
      respond(res, 500, { error: '요청 처리에 실패했습니다' });
    }
  });
}

export function startServer(): http.Server {
  const server = createServer();
  server.listen(config.server.port, () => {
    logger.info(`검색 서버 시작 — http://localhost:${config.server.port}`);
  });
  return server;
}
