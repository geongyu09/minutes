import { describe, it, expect } from 'vitest';
import { chunkDocument } from './chunker';
import type { RawDocument } from '@minutes/core';

function doc(markdown: string, overrides: Partial<RawDocument> = {}): RawDocument {
  return {
    id: 'doc-1',
    title: '3주차 회의',
    url: 'https://notion.so/doc-1',
    markdown,
    lastEditedTime: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('chunkDocument', () => {
  it('헤딩 기준으로 섹션을 분할한다', () => {
    const md = [
      '# 안건',
      '이번 주 안건은 로그인 방식 결정이다. '.repeat(20),
      '## 결정사항',
      '카카오 소셜 로그인으로 결정했다. '.repeat(20),
    ].join('\n');

    const chunks = chunkDocument(doc(md));
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.headingPath).toEqual(['안건']);
    expect(chunks[1].metadata.headingPath).toEqual(['안건', '결정사항']);
  });

  it('헤딩 레벨에 따라 headingPath 스택을 유지한다', () => {
    const md = [
      '# 1주차',
      '내용A '.repeat(30),
      '## 결정사항',
      '내용B '.repeat(30),
      '# 2주차',
      '내용C '.repeat(30),
    ].join('\n');

    const chunks = chunkDocument(doc(md));
    expect(chunks[0].metadata.headingPath).toEqual(['1주차']);
    expect(chunks[1].metadata.headingPath).toEqual(['1주차', '결정사항']);
    expect(chunks[2].metadata.headingPath).toEqual(['2주차']);
  });

  it('청크 본문 앞에 문서 제목과 헤딩 경로를 붙인다', () => {
    const md = ['# 결정사항', '카카오 로그인으로 결정. '.repeat(20)].join('\n');
    const [chunk] = chunkDocument(doc(md));
    expect(chunk.content).toContain('문서: 3주차 회의');
    expect(chunk.content).toContain('위치: 결정사항');
    expect(chunk.content).toContain('카카오 로그인으로 결정.');
  });

  it('청크 ID는 documentId:chunkIndex 형식이다', () => {
    const md = ['# A', '가나다 '.repeat(60), '# B', '라마바 '.repeat(60)].join('\n');
    const chunks = chunkDocument(doc(md));
    expect(chunks.map((c) => c.id)).toEqual(['doc-1:0', 'doc-1:1']);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
  });

  it('maxTokens를 초과하는 섹션은 문단 단위로 재분할한다', () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) =>
      `${i}번째 문단이다. 회의에서 논의된 내용을 자세히 기록한다. `.repeat(20)
    );
    const md = ['# 긴 섹션', paragraphs.join('\n\n')].join('\n');

    const chunks = chunkDocument(doc(md));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.metadata.tokenCount).toBeLessThanOrEqual(900);
      expect(chunk.metadata.headingPath).toEqual(['긴 섹션']);
    }
  });

  it('minTokens 미만의 섹션은 앞 청크에 병합한다', () => {
    const md = [
      '# 본문',
      '충분히 긴 본문 내용이다. '.repeat(30),
      '# 참석자',
      '홍길동',
    ].join('\n');

    const chunks = chunkDocument(doc(md));
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toContain('홍길동');
  });

  it('빈 문서는 빈 배열을 반환한다', () => {
    expect(chunkDocument(doc(''))).toEqual([]);
    expect(chunkDocument(doc('   \n  \n'))).toEqual([]);
  });

  it('메타데이터에 문서 정보가 들어간다', () => {
    const md = ['# 섹션', '내용입니다. '.repeat(30)].join('\n');
    const [chunk] = chunkDocument(doc(md));
    expect(chunk.documentId).toBe('doc-1');
    expect(chunk.metadata.documentTitle).toBe('3주차 회의');
    expect(chunk.metadata.documentUrl).toBe('https://notion.so/doc-1');
    expect(chunk.metadata.lastEditedTime).toBe('2026-07-01T00:00:00.000Z');
    expect(chunk.metadata.tokenCount).toBeGreaterThan(0);
  });
});
