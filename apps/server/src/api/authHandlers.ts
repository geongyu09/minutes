import type { LoginSession } from '@/auth/loginSessions';
import type { NotionProfile, User } from '@/auth/users';
import type { ProjectSummary } from '@/projects/projects';

/** Authorization: Bearer <토큰> 헤더에서 토큰만 꺼낸다. */
export function bearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader?.startsWith('Bearer ')) return null;
  const token = authorizationHeader.slice('Bearer '.length).trim();
  return token || null;
}

export interface AuthSessionDeps {
  createSession: () => LoginSession;
  buildAuthUrl: (state: string) => string;
}

export interface AuthSessionResult {
  status: number;
  body: { pollToken: string; authUrl: string };
}

/**
 * POST /auth/notion/session — "노션으로 로그인" 시작.
 * 앱은 authUrl을 브라우저로 열고, pollToken으로 앱 토큰 수령을 폴링한다.
 */
export function handleAuthSession(deps: AuthSessionDeps): AuthSessionResult {
  const session = deps.createSession();
  return {
    status: 200,
    body: { pollToken: session.pollToken, authUrl: deps.buildAuthUrl(session.state) },
  };
}

export interface AuthCallbackDeps {
  hasLoginState: (state: string) => boolean;
  /** 인가 코드를 노션 사용자 신원으로 교환한다 — 액세스 토큰은 저장하지 않는다. */
  exchangeIdentity: (code: string) => Promise<NotionProfile>;
  upsertUser: (profile: NotionProfile) => User;
  issueAppToken: (userId: string) => string;
  attachAppToken: (state: string, appToken: string) => boolean;
}

export interface AuthCallbackResult {
  status: number;
  html: string;
}

function callbackPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><body style="font-family: sans-serif; padding: 2rem;"><p>${message}</p></body>`;
}

const INVALID = '유효하지 않은 요청입니다. 앱에서 다시 로그인해주세요.';

/** GET /auth/notion/callback — 신원 확인 후 계정을 만들고(첫 로그인) 앱 토큰을 세션에 준비한다. */
export async function handleAuthCallback(
  query: { code?: string; state?: string; error?: string },
  deps: AuthCallbackDeps
): Promise<AuthCallbackResult> {
  if (query.error) {
    return { status: 400, html: callbackPage('로그인이 취소되었습니다. 창을 닫아주세요.') };
  }
  if (!query.code || !query.state) {
    return { status: 400, html: callbackPage(INVALID) };
  }
  // 노션 토큰 교환(외부 API 호출) 전에 state부터 검증한다 — 무의미한 외부 호출 유발 방지
  if (!deps.hasLoginState(query.state)) {
    return { status: 400, html: callbackPage(INVALID) };
  }

  const profile = await deps.exchangeIdentity(query.code);
  const user = deps.upsertUser(profile);
  const appToken = deps.issueAppToken(user.id);

  // 교환하는 사이에 세션이 만료됐을 수 있다 — 그러면 앱이 수령할 곳이 없으므로 실패로 끝낸다
  if (!deps.attachAppToken(query.state, appToken)) {
    return { status: 400, html: callbackPage(INVALID) };
  }

  return { status: 200, html: callbackPage('로그인이 완료되었습니다. 창을 닫고 앱으로 돌아가세요.') };
}

export interface AuthStatusResult {
  status: number;
  body: { authorized?: boolean; appToken?: string; error?: string };
}

/** GET /auth/notion/status — 앱이 앱 토큰을 폴링해 수령한다. 토큰은 일회성으로만 내려간다. */
export function handleAuthStatus(
  pollToken: string | null,
  deps: { claimAppToken: (pollToken: string) => string | null }
): AuthStatusResult {
  if (!pollToken) {
    return { status: 401, body: { error: '폴링 토큰이 필요합니다' } };
  }
  const appToken = deps.claimAppToken(pollToken);
  return appToken
    ? { status: 200, body: { authorized: true, appToken } }
    : { status: 200, body: { authorized: false } };
}

export interface SimpleResult {
  status: number;
  body: Record<string, unknown>;
}

/** POST /auth/logout — 앱 토큰 해시 행을 지운다. */
export function handleLogout(
  appToken: string | null,
  deps: { revokeAppToken: (appToken: string) => void }
): SimpleResult {
  if (!appToken) {
    return { status: 401, body: { error: '앱 토큰이 필요합니다' } };
  }
  deps.revokeAppToken(appToken);
  return { status: 200, body: { loggedOut: true } };
}

export interface MeResult {
  status: number;
  body: {
    user?: { id: string; name?: string; email?: string; avatarUrl?: string };
    projects?: ProjectSummary[];
    error?: string;
  };
}

/** GET /me — 내 계정과 소속 프로젝트 목록. 앱의 첫 화면이 이걸로 갈린다. */
export function handleMe(
  user: User | null,
  deps: { listProjects: (userId: string) => ProjectSummary[] }
): MeResult {
  if (!user) {
    return { status: 401, body: { error: '로그인이 필요합니다' } };
  }
  return {
    status: 200,
    body: {
      user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl },
      projects: deps.listProjects(user.id),
    },
  };
}
