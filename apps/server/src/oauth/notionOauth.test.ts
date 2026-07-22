import { describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({
  config: {
    notion: {
      oauthClientId: 'client-id',
      oauthClientSecret: 'client-secret',
      oauthRedirectUri: 'http://localhost:8787/auth/notion/callback',
      requestsPerSecond: 3,
      maxRetries: 5,
    },
  },
}));

import { buildAuthorizeUrl, exchangeCode, refreshTokens } from './notionOauth';

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const tokenResponse = {
  access_token: 'ntn_access',
  refresh_token: 'ntn_refresh',
  bot_id: 'bot-1',
  workspace_id: 'ws-1',
  workspace_name: '테스트 워크스페이스',
};

describe('buildAuthorizeUrl', () => {
  it('client_id, redirect_uri, state, owner=user를 포함한 인가 URL을 만든다', () => {
    const url = new URL(buildAuthorizeUrl('state-123'));
    expect(url.origin + url.pathname).toBe('https://api.notion.com/v1/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('owner')).toBe('user');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8787/auth/notion/callback');
    expect(url.searchParams.get('state')).toBe('state-123');
  });
});

describe('exchangeCode', () => {
  it('인가 코드를 토큰으로 교환하고 워크스페이스 정보를 반환한다', async () => {
    const fetchFn = fakeFetch(tokenResponse);
    const tokens = await exchangeCode('auth-code', fetchFn);

    expect(tokens).toEqual({
      accessToken: 'ntn_access',
      refreshToken: 'ntn_refresh',
      botId: 'bot-1',
      workspaceId: 'ws-1',
      workspaceName: '테스트 워크스페이스',
    });

    const [url, init] = (fetchFn as any).mock.calls[0];
    expect(url).toBe('https://api.notion.com/v1/oauth/token');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe(
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`
    );
    expect(JSON.parse(init.body)).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code',
      redirect_uri: 'http://localhost:8787/auth/notion/callback',
    });
  });

  it('토큰 엔드포인트가 실패하면 오류를 던진다', async () => {
    const fetchFn = fakeFetch({ error: 'invalid_grant' }, 400);
    await expect(exchangeCode('bad-code', fetchFn)).rejects.toThrow();
  });
});

describe('refreshTokens', () => {
  it('refresh_token으로 새 토큰을 발급받는다', async () => {
    const fetchFn = fakeFetch(tokenResponse);
    const tokens = await refreshTokens('old-refresh', fetchFn);

    expect(tokens.accessToken).toBe('ntn_access');
    expect(tokens.refreshToken).toBe('ntn_refresh');

    const [, init] = (fetchFn as any).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh',
    });
  });
});
