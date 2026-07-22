import { describe, it, expect } from 'vitest';
import { recallAtK } from './metrics';
import type { SearchResult } from '../src/core/types';

function result(documentId: string): SearchResult {
  return {
    chunk: {
      id: `${documentId}:0`,
      documentId,
      chunkIndex: 0,
      content: '내용',
      metadata: {
        documentTitle: '문서',
        documentUrl: 'https://notion.so/x',
        headingPath: [],
        lastEditedTime: '2026-07-01T00:00:00.000Z',
        tokenCount: 10,
      },
    },
    score: 0.9,
    source: 'hybrid',
  };
}

describe('recallAtK', () => {
  it('정답 문서를 모두 찾으면 1', () => {
    const results = [result('a'), result('b'), result('c')];
    expect(recallAtK(results, ['a', 'b'], 8)).toBe(1);
  });

  it('절반만 찾으면 0.5', () => {
    const results = [result('a'), result('x')];
    expect(recallAtK(results, ['a', 'b'], 8)).toBe(0.5);
  });

  it('상위 k개만 본다', () => {
    const results = [result('x'), result('y'), result('a')];
    expect(recallAtK(results, ['a'], 2)).toBe(0);
    expect(recallAtK(results, ['a'], 3)).toBe(1);
  });

  it('기대 문서가 없으면 1', () => {
    expect(recallAtK([result('a')], [], 8)).toBe(1);
  });

  it('결과가 비어 있으면 0', () => {
    expect(recallAtK([], ['a'], 8)).toBe(0);
  });
});
