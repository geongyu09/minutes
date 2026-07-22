import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai';
import { logger, type Message } from '@minutes/core';
import { searchClient } from '@/searchClient';
import { rewriteQuery } from '@/generation/queryRewriter';
import { buildPrompt } from '@/generation/promptBuilder';
import { getLlmClient } from '@/generation/llmClient';
import { extractCitations } from '@/generation/citationParser';

export const maxDuration = 300; // 로컬 CLI는 API보다 느리다

function toText(message: UIMessage): string {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const query = toText(messages[messages.length - 1]);
  const history: Message[] = messages.slice(0, -1).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: toText(m),
  }));

  const rewritten = await rewriteQuery(query, history);

  const t0 = Date.now();
  const results = await searchClient.search(rewritten);
  logger.info(`검색 완료 — ${results.length}건, ${Date.now() - t0}ms`);

  const prompt = buildPrompt(rewritten, results);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const client = await getLlmClient();

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

  return createUIMessageStreamResponse({ stream });
}
