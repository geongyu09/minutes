import { describe, it, expect } from 'vitest';
import { extractCitations } from './citationParser';
import type { SearchResult } from '@minutes/core';

function result(id: string, title: string): SearchResult {
  return {
    chunk: {
      id,
      documentId: id.split(':')[0],
      chunkIndex: 0,
      content: '내용',
      metadata: {
        documentTitle: title,
        documentUrl: `https://notion.so/${id.split(':')[0]}`,
        headingPath: ['결정사항'],
        lastEditedTime: '2026-07-01T00:00:00.000Z',
        tokenCount: 10,
      },
    },
    score: 0.9,
    source: 'hybrid',
  };
}

const sources = [result('a:0', '1주차 회의'), result('b:0', '2주차 회의'), result('c:0', '3주차 회의')];

describe('extractCitations', () => {
  it('답변에 등장한 출처 번호만 추출한다', () => {
    const citations = extractCitations('카카오 로그인으로 결정 [출처 1]. 배포는 Vercel [출처 3].', sources);
    expect(citations.map((c) => c.number)).toEqual([1, 3]);
  });

  it('중복된 번호는 한 번만 반환한다', () => {
    const citations = extractCitations('[출처 2] 그리고 [출처 2]', sources);
    expect(citations.map((c) => c.number)).toEqual([2]);
  });

  it('공백이 있는 표기([출처  1])도 인식한다', () => {
    const citations = extractCitations('[출처  1] 내용', sources);
    expect(citations.map((c) => c.number)).toEqual([1]);
  });

  it('범위 밖 번호(환각)는 버린다', () => {
    const citations = extractCitations('[출처 5] [출처 0] [출처 2]', sources);
    expect(citations.map((c) => c.number)).toEqual([2]);
  });

  it('번호 오름차순으로 정렬한다', () => {
    const citations = extractCitations('[출처 3] 먼저, [출처 1] 나중', sources);
    expect(citations.map((c) => c.number)).toEqual([1, 3]);
  });

  it('출처 메타데이터를 매핑한다', () => {
    const [citation] = extractCitations('[출처 2]', sources);
    expect(citation.documentTitle).toBe('2주차 회의');
    expect(citation.documentUrl).toBe('https://notion.so/b');
    expect(citation.headingPath).toEqual(['결정사항']);
  });

  it('인용이 없으면 빈 배열을 반환한다', () => {
    expect(extractCitations('출처 표기가 없는 답변', sources)).toEqual([]);
  });
});
