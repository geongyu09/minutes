import { describe, expect, it } from 'vitest';
import { createNotionAuthClient } from './notionAuth';

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function capturing(body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = createNotionAuthClient(
    'http://server:8787',
    async (url, init) => {
      calls.push({ url: String(url), init });
      return okResponse(body);
    },
    () => 'app-token'
  );
  return { calls, client };
}

describe('createNotionAuthClient', () => {
  it('startConnect는 프로젝트 스코프로 인가 URL을 받아온다', async () => {
    const { calls, client } = capturing({ authUrl: 'https://notion.example/authorize' });

    const authUrl = await client.startConnect('p-1');

    expect(calls[0].url).toBe('http://server:8787/oauth/notion/session?projectId=p-1');
    expect(calls[0].init?.method).toBe('POST');
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe('Bearer app-token');
    expect(authUrl).toBe('https://notion.example/authorize');
  });

  it('연결 변경도 같은 엔드포인트다 — 인가가 끝날 때까지 기존 연결은 살아 있다', async () => {
    const { calls, client } = capturing({ authUrl: 'https://notion.example/authorize?state=2' });

    await client.startConnect('p-1');

    expect(calls[0].url).toContain('/oauth/notion/session');
  });

  it('getStatus는 프로젝트의 연결 상태를 조회한다', async () => {
    const { calls, client } = capturing({ connected: true, workspaceName: '우리 팀' });

    const status = await client.getStatus('p-1');

    expect(calls[0].url).toBe('http://server:8787/oauth/notion/status?projectId=p-1');
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe('Bearer app-token');
    expect(status).toEqual({ connected: true, workspaceName: '우리 팀' });
  });

  it('cancel은 진행 중인 인가만 취소한다', async () => {
    const { calls, client } = capturing({ cancelled: true });

    await client.cancel('p-1');

    expect(calls[0].url).toBe('http://server:8787/oauth/notion/cancel?projectId=p-1');
    expect(calls[0].init?.method).toBe('POST');
  });

  it('서버 오류면 예외를 던진다', async () => {
    const client = createNotionAuthClient(
      'http://server:8787',
      async () => new Response('{}', { status: 500 }),
      () => 'app-token'
    );

    await expect(client.startConnect('p-1')).rejects.toThrow();
    await expect(client.getStatus('p-1')).rejects.toThrow();
  });
});
