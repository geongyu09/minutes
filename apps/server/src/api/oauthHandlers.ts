import type { User } from '@/auth/users';
import type { Membership } from '@/projects/projects';
import type {
  CompletedConnection,
  ConnectionSession,
  NotionConnection,
  WorkspaceGrant,
} from '@/oauth/connections';
import { requireMembership } from './projectHandlers';

type GetMembership = (projectId: string, userId: string) => Membership | null;

export interface OauthSessionDeps {
  getMembership: GetMembership;
  startConnection: (projectId: string, userId: string) => ConnectionSession;
  buildAuthUrl: (state: string) => string;
}

export interface OauthSessionResult {
  status: number;
  body: { authUrl?: string; error?: string };
}

/**
 * POST /oauth/notion/session — 프로젝트에 색인용 노션 인가를 시작한다 (owner 전용).
 * 이미 연결된 프로젝트에서 다시 호출하면 연결 변경이 된다 — 기존 연결·토큰은 인가가 끝날 때까지 살아 있다.
 */
export function handleOauthSession(
  user: User | null,
  projectId: string | undefined,
  deps: OauthSessionDeps
): OauthSessionResult {
  const check = requireMembership(user, projectId, deps.getMembership, 'owner');
  if (check.error) return check.error;

  const session = deps.startConnection(projectId!, user!.id);
  return { status: 200, body: { authUrl: deps.buildAuthUrl(session.state) } };
}

export interface OauthCancelDeps {
  getMembership: GetMembership;
  getConnection: (projectId: string) => NotionConnection | null;
  cancelAuthorization: (connectionId: string) => void;
}

export interface OauthCancelResult {
  status: number;
  body: { cancelled?: boolean; error?: string };
}

/**
 * POST /oauth/notion/cancel — 사용자가 "승인 대기 중"을 그만둔다.
 * 진행 중인 state만 버리므로 최초 연결이면 미연결로, 연결 변경 중이면 기존 연결이 그대로 남는다.
 * 진행 중인 인가가 없어도 200 — 취소는 멱등이다.
 */
export function handleOauthCancel(
  user: User | null,
  projectId: string | undefined,
  deps: OauthCancelDeps
): OauthCancelResult {
  const check = requireMembership(user, projectId, deps.getMembership, 'owner');
  if (check.error) return check.error;

  const connection = deps.getConnection(projectId!);
  if (connection) deps.cancelAuthorization(connection.id);
  return { status: 200, body: { cancelled: true } };
}

export interface OauthCallbackDeps {
  hasOauthState: (state: string) => boolean;
  exchange: (code: string) => Promise<WorkspaceGrant>;
  complete: (state: string, grant: WorkspaceGrant) => CompletedConnection | null;
  /** 워크스페이스가 바뀌었을 때 이전 색인 데이터를 비운다 (교차 유출 방지). */
  purgeIndexedData: (connectionId: string) => Promise<void>;
}

export interface OauthCallbackResult {
  status: number;
  html: string;
}

function callbackPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><body style="font-family: sans-serif; padding: 2rem;"><p>${message}</p></body>`;
}

/** GET /oauth/notion/callback — code를 액세스 토큰으로 교환해 state의 연결에 저장한다. */
export async function handleOauthCallback(
  query: { code?: string; state?: string; error?: string },
  deps: OauthCallbackDeps
): Promise<OauthCallbackResult> {
  if (query.error) {
    return { status: 400, html: callbackPage('노션 연결이 취소되었습니다. 창을 닫아주세요.') };
  }
  if (!query.code || !query.state) {
    return { status: 400, html: callbackPage('유효하지 않은 요청입니다. 앱에서 다시 시도해주세요.') };
  }
  // 노션 토큰 교환(외부 API 호출) 전에 state부터 검증한다 — 무의미한 외부 호출 유발 방지
  if (!deps.hasOauthState(query.state)) {
    return { status: 400, html: callbackPage('유효하지 않은 요청입니다. 앱에서 다시 시도해주세요.') };
  }

  const grant = await deps.exchange(query.code);
  const result = deps.complete(query.state, grant);
  if (!result) {
    return { status: 400, html: callbackPage('유효하지 않은 요청입니다. 앱에서 다시 시도해주세요.') };
  }

  // 워크스페이스가 바뀌었으면 이전 워크스페이스의 회의록이 남아 검색되면 안 된다
  if (result.workspaceChanged) {
    await deps.purgeIndexedData(result.connection.id);
  }

  return {
    status: 200,
    html: callbackPage('노션 연결이 완료되었습니다. 창을 닫고 앱으로 돌아가세요.'),
  };
}

export interface OauthStatusResult {
  status: number;
  body: { connected?: boolean; reconnecting?: boolean; workspaceName?: string; error?: string };
}

/**
 * GET /oauth/notion/status — 앱이 연결(또는 연결 변경) 완료 여부를 폴링한다.
 * 변경은 같은 워크스페이스를 다시 고를 수도 있어 이름 변화로 판단할 수 없으므로 `reconnecting`으로 알린다.
 * member도 조회할 수 있다 — 자기 프로젝트가 색인 가능한 상태인지 알아야 한다.
 */
export function handleOauthStatus(
  user: User | null,
  projectId: string | undefined,
  deps: { getMembership: GetMembership; getConnection: (projectId: string) => NotionConnection | null }
): OauthStatusResult {
  const check = requireMembership(user, projectId, deps.getMembership);
  if (check.error) return check.error;

  const connection = deps.getConnection(projectId!);
  if (!connection || connection.status !== 'connected') {
    return { status: 200, body: { connected: false, reconnecting: connection?.reconnecting ?? false } };
  }
  return {
    status: 200,
    body: {
      connected: true,
      reconnecting: connection.reconnecting,
      workspaceName: connection.workspaceName,
    },
  };
}
