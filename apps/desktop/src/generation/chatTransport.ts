/**
 * useChat용 로컬 ChatTransport — HTTP 엔드포인트 대신 웹뷰 안에서
 * 생성 파이프라인(질의 재작성 → 검색 → 프롬프트 조립 → CLI 스트리밍)을 직접 실행한다.
 * Tauri 정적 export에는 API 라우트가 없으므로 이 경로가 유일한 생성 진입점이다.
 */
import {
  createUIMessageStream,
  type ChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import { logger, type LlmClient, type Message, type SearchResult } from '@minutes/core';
import { searchClient } from '@/searchClient';
import { rewriteQuery } from './queryRewriter';
import { buildPrompt } from './promptBuilder';
import { getLlmClient } from './llmClient';
import { extractCitations } from './citationParser';

/** 생성 파이프라인 진행 단계 — data-stage 이벤트의 페이로드 */
export type PipelineStage =
  | { stage: 'rewriting' }
  | { stage: 'searching' }
  | { stage: 'generating'; resultCount: number };

interface ChatTransportDeps {
  search: (query: string) => Promise<SearchResult[]>;
  rewrite: (query: string, history: Message[]) => Promise<string>;
  getClient: () => Promise<LlmClient>;
}

function toText(message: UIMessage): string {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

export function createChatTransport(deps: Partial<ChatTransportDeps> = {}): ChatTransport<UIMessage> {
  const search = deps.search ?? ((query: string) => searchClient.search(query));
  const rewrite = deps.rewrite ?? rewriteQuery;
  const getClient = deps.getClient ?? getLlmClient;

  return {
    async sendMessages({ messages }): Promise<ReadableStream<UIMessageChunk>> {
      const query = toText(messages[messages.length - 1]);
      const history: Message[] = messages.slice(0, -1).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: toText(m),
      }));

      // 재작성·검색도 스트림 안에서 실행해야 UI가 진행 단계를 실시간으로 받는다
      return createUIMessageStream({
        // 기본값은 원인을 "An error occurred."로 가려 CLI 실패를 진단할 수 없다
        onError: (error) => (error instanceof Error ? error.message : String(error)),
        execute: async ({ writer }) => {
          writer.write({ type: 'data-stage', data: { stage: 'rewriting' } });
          const rewritten = await rewrite(query, history);

          writer.write({ type: 'data-stage', data: { stage: 'searching' } });
          const t0 = Date.now();
          const results = await search(rewritten);
          logger.info(`검색 완료 — ${results.length}건, ${Date.now() - t0}ms`);

          writer.write({ type: 'data-stage', data: { stage: 'generating', resultCount: results.length } });
          const prompt = buildPrompt(rewritten, results);
          const client = await getClient();

          const textId = 'answer';
          writer.write({ type: 'text-start', id: textId });
          let answer = '';
          for await (const delta of client.stream(prompt)) {
            answer += delta;
            writer.write({ type: 'text-delta', id: textId, delta });
          }
          writer.write({ type: 'text-end', id: textId });

          // 스트리밍이 끝난 뒤 전체 텍스트에서 인용을 파싱해 별도 이벤트로 전송
          const citations = extractCitations(answer, results);
          writer.write({ type: 'data-citations', data: citations });
        },
      });
    },

    async reconnectToStream() {
      return null; // 로컬 실행이라 재접속할 원격 스트림이 없다
    },
  };
}
