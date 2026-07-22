import { describe, expect, it } from 'vitest';
import { createNotionAuthClient } from './notionAuth';

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('createNotionAuthClient', () => {
  it('startSession은 서버에서 앱 토큰과 인가 URL을 받아온다', async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const client = createNotionAuthClient('http://server:8787', async (url, init) => {
      captured = { url: String(url), init };
      return okResponse({ appToken: 'app-token', authUrl: 'https://notion.example/authorize' });
    });

    const session = await client.startSession();

    expect(captured?.url).toBe('http://server:8787/oauth/notion/session');
    expect(captured?.init?.method).toBe('POST');
    expect(session).toEqual({ appToken: 'app-token', authUrl: 'https://notion.example/authorize' });
  });

  it('getStatus는 앱 토큰을 Bearer 헤더로 보내 연결 상태를 조회한다', async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const client = createNotionAuthClient('http://server:8787', async (url, init) => {
      captured = { url: String(url), init };
      return okResponse({ connected: true, workspaceName: '우리 팀' });
    });

    const status = await client.getStatus('app-token');

    expect(captured?.url).toBe('http://server:8787/oauth/notion/status');
    expect((captured?.init?.headers as Record<string, string>).authorization).toBe('Bearer app-token');
    expect(status).toEqual({ connected: true, workspaceName: '우리 팀' });
  });

  it('서버 오류면 예외를 던진다', async () => {
    const client = createNotionAuthClient('http://server:8787', async () =>
      new Response('{}', { status: 500 })
    );

    await expect(client.startSession()).rejects.toThrow();
    await expect(client.getStatus('t')).rejects.toThrow();
  });
});
