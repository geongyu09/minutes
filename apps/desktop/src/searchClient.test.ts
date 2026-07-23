import { describe, expect, it } from 'vitest';
import { createSearchClient } from './searchClient';

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('createSearchClient', () => {
  it('현재 프로젝트를 스코프로 서버 /search를 호출한다', async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const client = createSearchClient(
      'http://server:8787',
      async (url, init) => {
        captured = { url: String(url), init };
        return okResponse({ results: [{ chunk: { id: 'a' }, score: 1, source: 'hybrid' }], tookMs: 12 });
      },
      () => null,
      () => 'p-1'
    );

    const results = await client.search('휴가 정책');

    expect(captured?.url).toBe('http://server:8787/search?projectId=p-1');
    expect(JSON.parse(String(captured?.init?.body))).toEqual({ query: '휴가 정책' });
    expect(results).toHaveLength(1);
    expect(results[0].chunk.id).toBe('a');
  });

  it('앱 토큰이 있으면 Bearer 헤더로 보낸다', async () => {
    let captured: { init?: RequestInit } | undefined;
    const client = createSearchClient(
      'http://server:8787',
      async (_url, init) => {
        captured = { init };
        return okResponse({ results: [], tookMs: 1 });
      },
      () => 'app-token',
      () => 'p-1'
    );

    await client.search('q');

    expect((captured?.init?.headers as Record<string, string>).authorization).toBe('Bearer app-token');
  });

  it('선택된 프로젝트가 없으면 서버를 부르지 않는다', async () => {
    let called = false;
    const client = createSearchClient(
      'http://server:8787',
      async () => {
        called = true;
        return okResponse({ results: [], tookMs: 1 });
      },
      () => 'app-token',
      () => null
    );

    await expect(client.search('q')).rejects.toThrow(/프로젝트/);
    expect(called).toBe(false);
  });

  it('서버가 오류를 반환하면 예외를 던진다', async () => {
    const client = createSearchClient(
      'http://server:8787',
      async () => new Response(JSON.stringify({ error: '실패' }), { status: 500 }),
      () => null,
      () => 'p-1'
    );

    await expect(client.search('q')).rejects.toThrow(/검색 서버/);
  });
});
