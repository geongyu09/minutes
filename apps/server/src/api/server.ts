import http from 'node:http';
import { logger } from '@minutes/core';
import { config } from '@/config';
import { createRetriever } from '@/retrieval/retriever';
import { createVectorStore, countDocuments } from '@/retrieval/vectorStore';
import { getLastSyncTime } from '@/ingestion/syncState';
import { runIndexingForConnection } from '@/ingestion/indexer';
import { db } from '@/db';
import { checkEmbedding } from '@/embedder';
import {
  completeConnection,
  createPendingConnection,
  findByAppToken,
  hasPendingState,
  type NotionConnection,
} from '@/oauth/connections';
import { buildAuthorizeUrl, exchangeCode } from '@/oauth/notionOauth';
import { handleHealth, handleSearch } from './handlers';
import {
  authenticate,
  handleOauthCallback,
  handleOauthSession,
  handleOauthStatus,
} from './oauthHandlers';

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

/** Bearer 앱 토큰으로 요청 사용자를 식별한다. 토큰이 없으면 401, 연결 미완료면 403. */
function requireConnected(
  req: http.IncomingMessage,
  res: http.ServerResponse
): NotionConnection | null {
  const connection = authenticate(req.headers.authorization, findByAppToken);
  if (!connection) {
    respond(res, 401, { error: '앱 토큰이 필요합니다. 노션을 먼저 연결하세요.' });
    return null;
  }
  if (connection.status !== 'connected') {
    respond(res, 403, { error: '노션 연결이 완료되지 않았습니다.' });
    return null;
  }
  return connection;
}

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    try {
      if (req.method === 'POST' && url.pathname === '/oauth/notion/session') {
        const result = handleOauthSession({
          createSession: createPendingConnection,
          buildAuthUrl: buildAuthorizeUrl,
        });
        respond(res, result.status, result.body);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/oauth/notion/callback') {
        const result = await handleOauthCallback(
          {
            code: url.searchParams.get('code') ?? undefined,
            state: url.searchParams.get('state') ?? undefined,
            error: url.searchParams.get('error') ?? undefined,
          },
          { hasPendingState, exchange: exchangeCode, complete: completeConnection }
        );
        if (result.status === 200) logger.info('노션 워크스페이스 연결 완료');
        respondHtml(res, result.status, result.html);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/oauth/notion/status') {
        const connection = authenticate(req.headers.authorization, findByAppToken);
        const result = handleOauthStatus(connection);
        respond(res, result.status, result.body);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/search') {
        const connection = requireConnected(req, res);
        if (!connection) return;
        const result = await handleSearch(await readJson(req), createRetriever(connection.id));
        respond(res, result.status, result.body);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        const result = await handleHealth({ checkDb, checkEmbedding });
        respond(res, result.status, result.body);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/status') {
        const connection = requireConnected(req, res);
        if (!connection) return;
        respond(res, 200, {
          documentCount: await countDocuments(connection.id),
          chunkCount: await createVectorStore(connection.id).count(),
          lastSyncedAt: (await getLastSyncTime(connection.id)).toISOString(),
          workspaceName: connection.workspaceName,
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/index') {
        const connection = requireConnected(req, res);
        if (!connection) return;
        const mode = url.searchParams.get('mode') === 'full' ? 'full' : 'incremental';
        respond(res, 200, await runIndexingForConnection(connection, mode));
        return;
      }
      respond(res, 404, { error: '알 수 없는 경로입니다' });
    } catch (err) {
      logger.error(`요청 처리 실패: ${req.method} ${url.pathname}`, String(err));
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
