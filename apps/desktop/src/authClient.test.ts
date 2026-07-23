import { describe, expect, it } from 'vitest';
import { createAuthClient } from './authClient';

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('createAuthClient', () => {
  it('로그인을 시작하면 폴링 토큰과 인가 URL을 받는다', async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const client = createAuthClient('http://server:8787', async (url, init) => {
      captured = { url: String(url), init };
      return okResponse({ pollToken: 'poll-1', authUrl: 'https://notion.example/authorize' });
    });

    const session = await client.startLogin();

    expect(captured?.url).toBe('http://server:8787/auth/notion/session');
    expect(captured?.init?.method).toBe('POST');
    expect(session).toEqual({ pollToken: 'poll-1', authUrl: 'https://notion.example/authorize' });
  });

  it('폴링 토큰으로 앱 토큰 수령을 확인한다', async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const client = createAuthClient('http://server:8787', async (url, init) => {
      captured = { url: String(url), init };
      return okResponse({ authorized: true, appToken: 'app-token' });
    });

    const status = await client.pollLogin('poll-1');

    expect(captured?.url).toBe('http://server:8787/auth/notion/status');
    expect((captured?.init?.headers as Record<string, string>).authorization).toBe('Bearer poll-1');
    expect(status).toEqual({ authorized: true, appToken: 'app-token' });
  });

  it('내 계정과 프로젝트 목록을 가져온다', async () => {
    const client = createAuthClient(
      'http://server:8787',
      async () => okResponse({ user: { id: 'u-1' }, projects: [{ id: 'p-1', name: '팀', role: 'owner', connected: true }] }),
      () => 'app-token'
    );

    const me = await client.getMe();

    expect(me?.user.id).toBe('u-1');
    expect(me?.projects).toHaveLength(1);
  });

  it('앱 토큰이 만료·폐기되어 401이면 null을 돌려준다 (다시 로그인해야 한다)', async () => {
    const client = createAuthClient(
      'http://server:8787',
      async () => new Response('{}', { status: 401 }),
      () => 'stale-token'
    );

    expect(await client.getMe()).toBeNull();
  });

  it('로그아웃은 서버의 앱 토큰을 폐기한다', async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const client = createAuthClient(
      'http://server:8787',
      async (url, init) => {
        captured = { url: String(url), init };
        return okResponse({ loggedOut: true });
      },
      () => 'app-token'
    );

    await client.logout();

    expect(captured?.url).toBe('http://server:8787/auth/logout');
    expect((captured?.init?.headers as Record<string, string>).authorization).toBe('Bearer app-token');
  });

  it('로그아웃이 서버에서 실패해도 예외를 던지지 않는다 (앱은 어차피 토큰을 버린다)', async () => {
    const client = createAuthClient(
      'http://server:8787',
      async () => {
        throw new Error('네트워크 오류');
      },
      () => 'app-token'
    );

    await expect(client.logout()).resolves.toBeUndefined();
  });
});
