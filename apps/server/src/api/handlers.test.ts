import { describe, expect, it } from 'vitest';
import type { Retriever, SearchResult } from '@minutes/core';
import { handleHealth, handleIndex, handleSearch } from './handlers';

function fakeResult(id: string): SearchResult {
  return {
    chunk: {
      id,
      documentId: 'doc-1',
      chunkIndex: 0,
      content: '내용',
      metadata: {
        documentTitle: '회의록',
        documentUrl: 'https://notion.so/doc-1',
        headingPath: [],
        lastEditedTime: '2026-07-01T00:00:00.000Z',
        tokenCount: 10,
      },
    },
    score: 0.9,
    source: 'hybrid',
  };
}

function fakeRetriever(results: SearchResult[]): Retriever {
  return {
    retrieve: async (_query, options) => results.slice(0, options?.topK ?? results.length),
  };
}

describe('handleSearch', () => {
  it('질의를 검색해 결과를 반환한다', async () => {
    const res = await handleSearch({ query: '휴가 정책' }, fakeRetriever([fakeResult('a'), fakeResult('b')]));

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results?.[0].chunk.id).toBe('a');
    expect(typeof res.body.tookMs).toBe('number');
  });

  it('topK를 검색 옵션으로 전달한다', async () => {
    const res = await handleSearch(
      { query: '휴가 정책', topK: 1 },
      fakeRetriever([fakeResult('a'), fakeResult('b')]),
    );

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
  });

  it('query가 없거나 빈 문자열이면 400을 반환한다', async () => {
    const retriever = fakeRetriever([]);

    expect((await handleSearch({}, retriever)).status).toBe(400);
    expect((await handleSearch({ query: '   ' }, retriever)).status).toBe(400);
    expect((await handleSearch({ query: 42 }, retriever)).status).toBe(400);
  });

  it('topK가 유효 범위를 벗어나면 400을 반환한다', async () => {
    const retriever = fakeRetriever([]);

    expect((await handleSearch({ query: 'q', topK: 0 }, retriever)).status).toBe(400);
    expect((await handleSearch({ query: 'q', topK: 'many' }, retriever)).status).toBe(400);
  });
});

describe('handleHealth', () => {
  it('DB와 임베딩 API가 모두 정상이면 200을 반환한다', async () => {
    const res = await handleHealth({
      checkDb: async () => {},
      checkEmbedding: async () => {},
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok', embedding: 'ok' });
  });

  it('DB 확인이 실패하면 503과 오류 메시지를 반환한다', async () => {
    const res = await handleHealth({
      checkDb: async () => {
        throw new Error('no such table');
      },
      checkEmbedding: async () => {},
    });

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    expect(res.body.db).toContain('no such table');
    expect(res.body.embedding).toBe('ok');
  });

  it('임베딩 API 확인이 실패하면 503을 반환한다', async () => {
    const res = await handleHealth({
      checkDb: async () => {},
      checkEmbedding: async () => {
        throw new Error('GEMINI_API_KEY 인증 실패');
      },
    });

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    expect(res.body.db).toBe('ok');
    expect(res.body.embedding).toContain('인증 실패');
  });
});

describe('handleIndex', () => {
  function deps(overrides: Partial<Parameters<typeof handleIndex>[1]> = {}) {
    const calls: string[] = [];
    return {
      calls,
      deps: {
        clearCursor: async () => {
          calls.push('clear');
        },
        start: () => {
          calls.push('start');
          return true;
        },
        getState: () => ({ status: 'idle' }) as const,
        ...overrides,
      },
    };
  }

  it('full 모드는 잡 시작 전에 커서를 리셋하고 202를 반환한다', async () => {
    const { calls, deps: d } = deps();
    const res = await handleIndex('full', d);

    expect(calls).toEqual(['clear', 'start']);
    expect(res.status).toBe(202);
  });

  it('incremental 모드는 커서를 리셋하지 않는다', async () => {
    const { calls, deps: d } = deps();
    const res = await handleIndex('incremental', d);

    expect(calls).toEqual(['start']);
    expect(res.status).toBe(202);
  });

  it('이미 실행 중이면 409를 반환하고 커서를 건드리지 않는다', async () => {
    const { calls, deps: d } = deps({
      getState: () => ({ status: 'running', mode: 'full', indexed: 3, total: 10 }) as const,
    });
    const res = await handleIndex('full', d);

    expect(calls).toEqual([]);
    expect(res.status).toBe(409);
    expect(res.body.job.status).toBe('running');
  });

  it('start가 경합으로 실패하면 409를 반환한다', async () => {
    const { deps: d } = deps({ start: () => false });
    const res = await handleIndex('incremental', d);

    expect(res.status).toBe(409);
  });
});
