import { describe, it, expect } from 'vitest';
import { fuseResults } from './hybridSearch';
import type { SearchResult } from '@minutes/core';

function result(id: string, score: number, source: SearchResult['source'] = 'vector'): SearchResult {
  return {
    chunk: {
      id,
      documentId: id.split(':')[0],
      chunkIndex: 0,
      content: `내용 ${id}`,
      metadata: {
        documentTitle: '문서',
        documentUrl: 'https://notion.so/x',
        headingPath: [],
        lastEditedTime: '2026-07-01T00:00:00.000Z',
        tokenCount: 100,
      },
    },
    score,
    source,
  };
}

describe('fuseResults', () => {
  it('양쪽에 모두 등장하는 청크가 한쪽에만 있는 청크보다 위로 온다', () => {
    const vector = [result('a:0', 0.9), result('b:0', 0.8)];
    const keyword = [result('b:0', 5.0, 'keyword'), result('c:0', 3.0, 'keyword')];

    const fused = fuseResults(vector, keyword);
    expect(fused[0].chunk.id).toBe('b:0');
  });

  it('결과 source는 hybrid로 표시된다', () => {
    const fused = fuseResults([result('a:0', 0.9)], [result('b:0', 1.0, 'keyword')]);
    for (const r of fused) expect(r.source).toBe('hybrid');
  });

  it('점수 내림차순으로 정렬된다', () => {
    const fused = fuseResults(
      [result('a:0', 0.9), result('b:0', 0.8), result('c:0', 0.7)],
      [result('c:0', 2.0, 'keyword')]
    );
    const scores = fused.map((r) => r.score);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
  });

  it('중복 없이 합집합을 반환한다', () => {
    const fused = fuseResults(
      [result('a:0', 0.9), result('b:0', 0.8)],
      [result('b:0', 2.0, 'keyword'), result('c:0', 1.0, 'keyword')]
    );
    expect(fused.map((r) => r.chunk.id).sort()).toEqual(['a:0', 'b:0', 'c:0']);
  });

  it('빈 입력이면 빈 배열을 반환한다', () => {
    expect(fuseResults([], [])).toEqual([]);
  });

  it('벡터 가중치(0.7)가 키워드 가중치(0.3)보다 크다 — 같은 순위면 벡터 쪽이 위', () => {
    const fused = fuseResults([result('a:0', 0.5)], [result('b:0', 9.0, 'keyword')]);
    expect(fused[0].chunk.id).toBe('a:0');
  });
});
