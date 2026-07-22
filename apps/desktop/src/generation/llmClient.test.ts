import { describe, expect, it } from 'vitest';
import { createLlmClient, createStreamJsonParser, detectProvider, renderPrompt } from './llmClient';
import type { CliExecution, CliRunner } from './cliRunner';
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

function fakeRunner(options: {
  lines?: string[];
  code?: number | null;
  stderr?: string;
  installed?: string[];
}): CliRunner & { calls: { program: string; args: string[] }[] } {
  const { lines = [], code = 0, stderr = '', installed = [] } = options;
  const calls: { program: string; args: string[] }[] = [];

  const execution = (): CliExecution => ({
    lines: (async function* () {
      for (const line of lines) yield line;
    })(),
    wait: async () => ({ code, stderr }),
    kill: () => {},
  });

  return {
    calls,
    async run(program, args) {
      calls.push({ program, args });
      return execution();
    },
    async isInstalled(program) {
      return installed.includes(program);
    },
  };
}

async function collectStream(iterable: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const chunk of iterable) out += chunk;
  return out;
}

describe('createLlmClient', () => {
  it('claude는 stream-json 줄을 파싱해 텍스트 델타만 내놓는다', async () => {
    const runner = fakeRunner({
      lines: [
        JSON.stringify({ type: 'system', subtype: 'init' }),
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '안녕' } },
        }),
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '하세요' } },
        }),
      ],
    });
    const client = createLlmClient('claude', runner);

    expect(await collectStream(client.stream(context))).toBe('안녕하세요');
    expect(runner.calls[0].program).toBe('claude');
    expect(runner.calls[0].args).toContain('stream-json');
  });

  it('codex/gemini는 줄을 개행으로 이어 그대로 통과시킨다', async () => {
    const runner = fakeRunner({ lines: ['첫 줄', '둘째 줄'] });
    const client = createLlmClient('gemini', runner);

    expect(await collectStream(client.stream(context))).toBe('첫 줄\n둘째 줄');
  });

  it('종료 코드가 0이 아니면 stderr를 포함한 오류를 던진다', async () => {
    const runner = fakeRunner({ code: 1, stderr: '로그인이 필요합니다' });
    const client = createLlmClient('claude', runner);

    await expect(collectStream(client.stream(context))).rejects.toThrow('로그인이 필요합니다');
  });

  it('isAvailable은 runner의 설치 여부를 따른다', async () => {
    const runner = fakeRunner({ installed: ['claude'] });

    expect(await createLlmClient('claude', runner).isAvailable()).toBe(true);
    expect(await createLlmClient('codex', runner).isAvailable()).toBe(false);
  });
});

describe('detectProvider', () => {
  it('claude → codex → gemini 순서로 처음 설치된 CLI를 고른다', async () => {
    expect(await detectProvider(fakeRunner({ installed: ['codex', 'gemini'] }))).toBe('codex');
    expect(await detectProvider(fakeRunner({ installed: ['gemini', 'claude'] }))).toBe('claude');
  });

  it('설치된 CLI가 없으면 안내 메시지와 함께 실패한다', async () => {
    await expect(detectProvider(fakeRunner({}))).rejects.toThrow('claude, codex, gemini');
  });
});
