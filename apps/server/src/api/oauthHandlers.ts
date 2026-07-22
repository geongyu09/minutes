import type { ConnectionSession, NotionConnection, WorkspaceGrant } from '@/oauth/connections';

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

export interface OauthCallbackDeps {
  hasPendingState: (state: string) => boolean;
  exchange: (code: string) => Promise<WorkspaceGrant>;
  complete: (state: string, grant: WorkspaceGrant) => NotionConnection | null;
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
  if (!deps.hasPendingState(query.state)) {
    return { status: 400, html: callbackPage('유효하지 않은 요청입니다. 앱에서 다시 시도해주세요.') };
  }

  const grant = await deps.exchange(query.code);
  const connection = deps.complete(query.state, grant);
  if (!connection) {
    return { status: 400, html: callbackPage('유효하지 않은 요청입니다. 앱에서 다시 시도해주세요.') };
  }

  return {
    status: 200,
    html: callbackPage('노션 연결이 완료되었습니다. 창을 닫고 앱으로 돌아가세요.'),
  };
}

export interface OauthStatusResult {
  status: number;
  body: { connected?: boolean; workspaceName?: string; error?: string };
}

/** GET /oauth/notion/status — 앱이 연결 완료 여부를 폴링한다. */
export function handleOauthStatus(connection: NotionConnection | null): OauthStatusResult {
  if (!connection) {
    return { status: 401, body: { error: '유효하지 않은 앱 토큰입니다' } };
  }
  if (connection.status !== 'connected') {
    return { status: 200, body: { connected: false } };
  }
  return { status: 200, body: { connected: true, workspaceName: connection.workspaceName } };
}
