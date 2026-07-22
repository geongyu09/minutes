import { describe, it, expect } from 'vitest';
import { buildPrompt } from './promptBuilder';
import type { SearchResult } from '@minutes/core';

function result(id: string, content: string, headingPath: string[] = []): SearchResult {
  return {
    chunk: {
      id,
      documentId: id.split(':')[0],
      chunkIndex: 0,
      content,
      metadata: {
        documentTitle: '2주차 회의',
        documentUrl: 'https://notion.so/doc',
        headingPath,
        lastEditedTime: '2026-07-01T09:30:00.000Z',
        tokenCount: 50,
      },
    },
    score: 0.9,
    source: 'hybrid',
  };
}

describe('buildPrompt', () => {
  it('시스템 프롬프트에 핵심 규칙이 들어간다', () => {
    const prompt = buildPrompt('질문', [result('a:0', '내용')]);
    expect(prompt.systemPrompt).toContain('문서에 없는 내용은 추측하지 않습니다');
    expect(prompt.systemPrompt).toContain('[출처 1]');
  });

  it('출처 블록이 [출처 N] 순서대로 번호가 매겨진다', () => {
    const prompt = buildPrompt('질문', [result('a:0', '첫번째 내용'), result('b:0', '두번째 내용')]);
    expect(prompt.userMessage).toContain('[출처 1]');
    expect(prompt.userMessage).toContain('[출처 2]');
    expect(prompt.userMessage.indexOf('첫번째 내용')).toBeLessThan(
      prompt.userMessage.indexOf('두번째 내용')
    );
  });

  it('출처 블록에 문서명·위치·최종 수정 시각이 포함된다', () => {
    const prompt = buildPrompt('질문', [result('a:0', '내용', ['안건', '결정사항'])]);
    expect(prompt.userMessage).toContain('문서: 2주차 회의');
    expect(prompt.userMessage).toContain('위치: 안건 > 결정사항');
    expect(prompt.userMessage).toContain('최종 수정: 2026-07-01');
  });

  it('헤딩 경로가 없으면 위치 줄을 생략한다', () => {
    const prompt = buildPrompt('질문', [result('a:0', '내용')]);
    expect(prompt.userMessage).not.toContain('위치:');
  });

  it('출처 블록은 === 구분자로 나뉜다', () => {
    const prompt = buildPrompt('질문', [result('a:0', 'A'), result('b:0', 'B')]);
    expect(prompt.userMessage).toContain('\n\n===\n\n');
  });

  it('사용자 질문이 포함된다', () => {
    const prompt = buildPrompt('로그인 방식 뭐로 정했지?', [result('a:0', '내용')]);
    expect(prompt.userMessage).toContain('로그인 방식 뭐로 정했지?');
  });

  it('sources가 그대로 전달된다', () => {
    const sources = [result('a:0', 'A'), result('b:0', 'B')];
    const prompt = buildPrompt('질문', sources);
    expect(prompt.sources).toBe(sources);
  });
});
