import { describe, expect, it } from 'vitest';
import type { Retriever, SearchResult } from '@minutes/core';
import { handleHealth, handleSearch } from './handlers';

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
  it('DB와 Ollama가 모두 정상이면 200을 반환한다', async () => {
    const res = await handleHealth({
      checkDb: async () => {},
      checkOllama: async () => {},
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok', ollama: 'ok' });
  });

  it('DB 확인이 실패하면 503과 오류 메시지를 반환한다', async () => {
    const res = await handleHealth({
      checkDb: async () => {
        throw new Error('no such table');
      },
      checkOllama: async () => {},
    });

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    expect(res.body.db).toContain('no such table');
    expect(res.body.ollama).toBe('ok');
  });

  it('Ollama 확인이 실패하면 503을 반환한다', async () => {
    const res = await handleHealth({
      checkDb: async () => {},
      checkOllama: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    });

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    expect(res.body.db).toBe('ok');
    expect(res.body.ollama).toContain('ECONNREFUSED');
  });
});
