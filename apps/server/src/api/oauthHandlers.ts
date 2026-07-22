import type {
  CompletedConnection,
  ConnectionSession,
  NotionConnection,
  WorkspaceGrant,
} from '@/oauth/connections';

/** Authorization: Bearer <앱 토큰> 헤더로 요청 사용자의 연결을 찾는다. */
export function authenticate(
  authorizationHeader: string | undefined,
  find: (appToken: string) => NotionConnection | null
): NotionConnection | null {
  if (!authorizationHeader?.startsWith('Bearer ')) return null;
  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token) return null;
  return find(token);
}

export interface OauthSessionDeps {
  createSession: () => ConnectionSession;
  buildAuthUrl: (state: string) => string;
}

export interface OauthSessionResult {
  status: number;
  body: { appToken: string; authUrl: string };
}

/**
 * POST /oauth/notion/session — 데스크톱 앱이 연결을 시작한다.
 * 앱 토큰(이후 모든 요청의 Bearer 인증)과 노션 인가 URL을 발급한다.
 */
export function handleOauthSession(deps: OauthSessionDeps): OauthSessionResult {
  const session = deps.createSession();
  return {
    status: 200,
    body: { appToken: session.appToken, authUrl: deps.buildAuthUrl(session.state) },
  };
}

export interface OauthReconnectDeps {
  startReconnect: (connectionId: string) => string | null;
  buildAuthUrl: (state: string) => string;
}

export interface OauthReconnectResult {
  status: number;
  body: { authUrl?: string; error?: string };
}

/**
 * POST /oauth/notion/reconnect — 연결한 노션 워크스페이스를 바꾼다.
 * 앱 토큰과 기존 연결은 그대로 두고 인가 URL만 새로 발급한다 — 인가를 포기해도 기존 연결이 살아 있다.
 */
export function handleOauthReconnect(
  connection: NotionConnection | null,
  deps: OauthReconnectDeps
): OauthReconnectResult {
  if (!connection) {
    return { status: 401, body: { error: '유효하지 않은 앱 토큰입니다' } };
  }
  if (connection.status !== 'connected') {
    return { status: 403, body: { error: '아직 연결되지 않았습니다. 먼저 노션을 연결하세요.' } };
  }

  const state = deps.startReconnect(connection.id);
  if (!state) {
    return { status: 404, body: { error: '연결을 찾을 수 없습니다' } };
  }
  return { status: 200, body: { authUrl: deps.buildAuthUrl(state) } };
}

export interface OauthCancelDeps {
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
  connection: NotionConnection | null,
  deps: OauthCancelDeps
): OauthCancelResult {
  if (!connection) {
    return { status: 401, body: { error: '유효하지 않은 앱 토큰입니다' } };
  }
  deps.cancelAuthorization(connection.id);
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
 */
export function handleOauthStatus(connection: NotionConnection | null): OauthStatusResult {
  if (!connection) {
    return { status: 401, body: { error: '유효하지 않은 앱 토큰입니다' } };
  }
  if (connection.status !== 'connected') {
    return { status: 200, body: { connected: false, reconnecting: connection.reconnecting } };
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
