import { describe, expect, it } from 'vitest';
import { createStreamJsonParser, renderPrompt } from './llmClient';
import type { PromptContext } from '@minutes/core';

const context: PromptContext = {
  systemPrompt: '시스템 지시',
  userMessage: '사용자 질문',
  sources: [],
};

describe('renderPrompt', () => {
  it('시스템 프롬프트와 사용자 메시지를 하나의 프롬프트로 합친다', () => {
    expect(renderPrompt(context)).toBe('시스템 지시\n\n사용자 질문');
  });
});

describe('createStreamJsonParser (claude --output-format stream-json)', () => {
  it('content_block_delta의 텍스트를 순서대로 내놓는다', () => {
    const parse = createStreamJsonParser();
    const line = (text: string) =>
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
      });
    expect(parse(line('안녕'))).toBe('안녕');
    expect(parse(line('하세요'))).toBe('하세요');
  });

  it('부분 델타가 없으면 assistant 메시지 전체 텍스트를 내놓는다', () => {
    const parse = createStreamJsonParser();
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '전체 답변' }] },
    });
    expect(parse(line)).toBe('전체 답변');
  });

  it('델타를 이미 내놓았다면 assistant/result 메시지로 중복 출력하지 않는다', () => {
    const parse = createStreamJsonParser();
    parse(
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '답변' } },
      })
    );
    expect(
      parse(
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '답변' }] } })
      )
    ).toBe('');
    expect(parse(JSON.stringify({ type: 'result', result: '답변' }))).toBe('');
  });

  it('아무것도 내놓지 못했다면 result 이벤트의 텍스트를 내놓는다', () => {
    const parse = createStreamJsonParser();
    expect(parse(JSON.stringify({ type: 'system', subtype: 'init' }))).toBe('');
    expect(parse(JSON.stringify({ type: 'result', result: '최종 답변' }))).toBe('최종 답변');
  });

  it('JSON이 아닌 줄과 텍스트 없는 이벤트는 무시한다', () => {
    const parse = createStreamJsonParser();
    expect(parse('not-json')).toBe('');
    expect(
      parse(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'input_json_delta' } },
        })
      )
    ).toBe('');
  });
});
