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

/** 사용자를 노션 인가 화면으로 보낼 URL을 만든다. */
export function buildAuthorizeUrl(state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', config.notion.oauthClientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('owner', 'user');
  url.searchParams.set('redirect_uri', config.notion.oauthRedirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

async function requestTokens(
  body: Record<string, string>,
  fetchFn: typeof fetch
): Promise<OAuthTokens> {
  const { oauthClientId, oauthClientSecret } = config.notion;
  if (!oauthClientId || !oauthClientSecret) {
    throw new Error('NOTION_OAUTH_CLIENT_ID/SECRET이 설정되지 않았습니다');
  }
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from(`${oauthClientId}:${oauthClientSecret}`).toString('base64')}`,
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

/** refresh_token으로 만료된 액세스 토큰을 갱신한다. */
export function refreshTokens(
  refreshToken: string,
  fetchFn: typeof fetch = fetch
): Promise<OAuthTokens> {
  return requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken }, fetchFn);
}
