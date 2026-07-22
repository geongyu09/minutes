import { describe, expect, it } from 'vitest';
import type { UIMessage, UIMessageChunk } from 'ai';
import type { LlmClient, SearchResult } from '@minutes/core';
import { createChatTransport } from './chatTransport';

function userMessage(id: string, text: string, role: 'user' | 'assistant' = 'user'): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] } as UIMessage;
}

function fakeResult(id: string): SearchResult {
  return {
    chunk: {
      id,
      documentId: 'doc-1',
      chunkIndex: 0,
      content: '휴가는 연 15일이다',
      metadata: {
        documentTitle: '인사 회의록',
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

function fakeLlm(chunks: string[]): LlmClient {
  return {
    provider: 'claude',
    async *stream() {
      for (const chunk of chunks) yield chunk;
    },
    isAvailable: async () => true,
  };
}

async function readAll(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

async function send(transport: ReturnType<typeof createChatTransport>, messages: UIMessage[]) {
  return transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: undefined,
    messages,
    abortSignal: undefined,
  });
}

describe('createChatTransport', () => {
  it('검색 결과로 프롬프트를 만들어 CLI 스트림을 텍스트 델타로 내보낸다', async () => {
    const searched: string[] = [];
    const transport = createChatTransport({
      search: async (query) => {
        searched.push(query);
        return [fakeResult('a')];
      },
      rewrite: async (query) => query,
      getClient: async () => fakeLlm(['휴가는 ', '15일입니다 [출처 1]']),
    });

    const chunks = await readAll(await send(transport, [userMessage('m1', '휴가 며칠?')]));

    expect(searched).toEqual(['휴가 며칠?']);
    const deltas = chunks
      .filter((c): c is Extract<UIMessageChunk, { type: 'text-delta' }> => c.type === 'text-delta')
      .map((c) => c.delta);
    expect(deltas.join('')).toBe('휴가는 15일입니다 [출처 1]');
  });

  it('스트림이 끝나면 인용을 파싱해 data-citations로 내보낸다', async () => {
    const transport = createChatTransport({
      search: async () => [fakeResult('a')],
      rewrite: async (query) => query,
      getClient: async () => fakeLlm(['답은 [출처 1]입니다']),
    });

    const chunks = await readAll(await send(transport, [userMessage('m1', '질문')]));

    const citations = chunks.find((c) => c.type === 'data-citations');
    expect(citations).toBeDefined();
    const data = (citations as { data: { number: number; documentTitle: string }[] }).data;
    expect(data[0].number).toBe(1);
    expect(data[0].documentTitle).toBe('인사 회의록');
  });

  it('파이프라인 진행 단계를 data-stage 이벤트로 순서대로 내보낸다', async () => {
    const transport = createChatTransport({
      search: async () => [fakeResult('a'), fakeResult('b')],
      rewrite: async (query) => query,
      getClient: async () => fakeLlm(['답']),
    });

    const chunks = await readAll(await send(transport, [userMessage('m1', '질문')]));

    const stages = chunks
      .filter((c): c is Extract<UIMessageChunk, { type: `data-${string}` }> => c.type === 'data-stage')
      .map((c) => c.data);
    expect(stages).toEqual([
      { stage: 'rewriting' },
      { stage: 'searching' },
      { stage: 'generating', resultCount: 2 },
    ]);

    // 단계 이벤트는 텍스트 스트리밍이 시작되기 전에 모두 도착해야 한다
    const firstTextIndex = chunks.findIndex((c) => c.type === 'text-start');
    const lastStageIndex = chunks.map((c) => c.type).lastIndexOf('data-stage');
    expect(lastStageIndex).toBeLessThan(firstTextIndex);
  });

  it('이전 대화가 있으면 재작성된 질의로 검색한다', async () => {
    const searched: string[] = [];
    const transport = createChatTransport({
      search: async (query) => {
        searched.push(query);
        return [fakeResult('a')];
      },
      rewrite: async () => '휴가 정책은 며칠인가?',
      getClient: async () => fakeLlm(['답']),
    });

    await readAll(
      await send(transport, [
        userMessage('m1', '휴가 정책 알려줘'),
        userMessage('m2', '연 15일입니다', 'assistant'),
        userMessage('m3', '그건 며칠이지?'),
      ])
    );

    expect(searched).toEqual(['휴가 정책은 며칠인가?']);
  });
});
