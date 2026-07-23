import { config } from '@/config';

// 노션 OAuth 엔드포인트 — API 스펙 상수 (튜닝 대상 아님)
const AUTHORIZE_URL = 'https://api.notion.com/v1/oauth/authorize';
const TOKEN_URL = 'https://api.notion.com/v1/oauth/token';

/** 노션 OAuth 토큰 교환 결과 — 워크스페이스 연결 한 건에 해당한다. */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  botId: string;
  workspaceId: string;
  workspaceName?: string;
}

/** 노션으로 로그인한 사용자의 신원 — 색인용 토큰과 달리 저장하지 않고 식별에만 쓴다. */
export interface NotionIdentity {
  notionUserId: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

/** 목적(색인용/로그인용)마다 다를 수 있는 노션 OAuth 자격 — client id/secret·콜백 URI. */
interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function indexingCreds(): OAuthCredentials {
  const { oauthClientId, oauthClientSecret, oauthRedirectUri } = config.notion;
  return { clientId: oauthClientId, clientSecret: oauthClientSecret, redirectUri: oauthRedirectUri };
}

function loginCreds(): OAuthCredentials {
  const { oauthLoginClientId, oauthLoginClientSecret, oauthLoginRedirectUri } = config.notion;
  return {
    clientId: oauthLoginClientId,
    clientSecret: oauthLoginClientSecret,
    redirectUri: oauthLoginRedirectUri,
  };
}

function authorizeUrl(state: string, creds: OAuthCredentials): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', creds.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('owner', 'user');
  url.searchParams.set('redirect_uri', creds.redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

/** 색인용 워크스페이스 연결 인가 URL — 여기서 고른 페이지만 색인된다. */
export function buildAuthorizeUrl(state: string): string {
  return authorizeUrl(state, indexingCreds());
}

/**
 * 로그인 인가 URL — 별도 통합(client id/secret)·콜백을 쓴다.
 * 목적(로그인 vs 색인)이 다른 토큰을 섞으면 페이지 선택 범위와 폐기 시점이 꼬인다.
 */
export function buildLoginAuthorizeUrl(state: string): string {
  return authorizeUrl(state, loginCreds());
}

async function postToken(
  body: Record<string, string>,
  creds: OAuthCredentials,
  fetchFn: typeof fetch
): Promise<any> {
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error('노션 OAuth client id/secret이 설정되지 않았습니다');
  }
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`노션 토큰 발급 실패 (${res.status})`);
  }

  const data: any = await res.json();
  if (!data?.access_token) {
    throw new Error('노션 토큰 응답이 유효하지 않습니다 (access_token 누락)');
  }
  return data;
}

async function requestTokens(
  body: Record<string, string>,
  fetchFn: typeof fetch
): Promise<OAuthTokens> {
  const data = await postToken(body, indexingCreds(), fetchFn);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? undefined,
    botId: data.bot_id,
    workspaceId: data.workspace_id,
    workspaceName: data.workspace_name ?? undefined,
  };
}

/** 인가 코드를 액세스 토큰으로 교환한다. */
export function exchangeCode(code: string, fetchFn: typeof fetch = fetch): Promise<OAuthTokens> {
  return requestTokens(
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.notion.oauthRedirectUri,
    },
    fetchFn
  );
}

/**
 * 로그인 인가 코드를 노션 사용자 신원으로 교환한다.
 * 여기서 받은 액세스 토큰은 식별에만 쓰고 **반환하지도 저장하지도 않는다** — 색인용 토큰과 분리한다.
 */
export async function exchangeCodeForIdentity(
  code: string,
  fetchFn: typeof fetch = fetch
): Promise<NotionIdentity> {
  const creds = loginCreds();
  const data = await postToken(
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: creds.redirectUri,
    },
    creds,
    fetchFn
  );

  const user = data?.owner?.user;
  if (!user?.id) {
    throw new Error('노션 인가 응답에 사용자 정보가 없습니다 (owner.user 누락)');
  }
  return {
    notionUserId: user.id,
    email: user.person?.email ?? undefined,
    name: user.name ?? undefined,
    avatarUrl: user.avatar_url ?? undefined,
  };
}

/** refresh_token으로 만료된 액세스 토큰을 갱신한다. */
export function refreshTokens(
  refreshToken: string,
  fetchFn: typeof fetch = fetch
): Promise<OAuthTokens> {
  return requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken }, fetchFn);
}
