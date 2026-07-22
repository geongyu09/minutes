import { describe, expect, it } from 'vitest';
import { createSearchClient } from './searchClient';

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('createSearchClient', () => {
  it('서버 /search를 호출해 결과를 반환한다', async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const client = createSearchClient('http://server:8787', async (url, init) => {
      captured = { url: String(url), init };
      return okResponse({ results: [{ chunk: { id: 'a' }, score: 1, source: 'hybrid' }], tookMs: 12 });
    });

    const results = await client.search('휴가 정책');

    expect(captured?.url).toBe('http://server:8787/search');
    expect(JSON.parse(String(captured?.init?.body))).toEqual({ query: '휴가 정책' });
    expect(results).toHaveLength(1);
    expect(results[0].chunk.id).toBe('a');
  });

  it('서버가 오류를 반환하면 예외를 던진다', async () => {
    const client = createSearchClient('http://server:8787', async () =>
      new Response(JSON.stringify({ error: '실패' }), { status: 500 }),
    );

    await expect(client.search('q')).rejects.toThrow(/검색 서버/);
  });
});
