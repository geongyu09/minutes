import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai';
import { config } from '@/core/config';
import { countTokens } from '@/core/tokens';
import { startTrace, saveTrace } from '@/core/trace';
import { logger } from '@/core/logger';
import { retriever } from '@/retrieval/retriever';
import { rewriteQuery } from '@/generation/queryRewriter';
import { buildPrompt } from '@/generation/promptBuilder';
import { llm } from '@/generation/llmClient';
import { extractCitations } from '@/generation/citationParser';
import type { Message } from '@/core/types';

export const maxDuration = 60;

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

  const totalStart = Date.now();
  const trace = startTrace(query);

  const rewritten = await rewriteQuery(query, history);
  trace.rewrittenQuery = rewritten;

  const t0 = Date.now();
  const results = await retriever.retrieve(rewritten);
  trace.latencyMs.retrieval = Date.now() - t0;
  trace.retrievedChunks = results.map((r) => ({
    id: r.chunk.id,
    score: r.score,
    preview: r.chunk.content.slice(0, 100),
  }));

  const prompt = buildPrompt(rewritten, results);
  trace.promptTokens = countTokens(prompt.systemPrompt + prompt.userMessage);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const generationStart = Date.now();
      const result = llm.stream({
        system: prompt.systemPrompt,
        messages: [{ role: 'user', content: prompt.userMessage }],
        maxTokens: config.generation.maxTokens,
        temperature: config.generation.temperature,
      });

      writer.merge(result.toUIMessageStream());

      // 스트리밍이 끝난 뒤 전체 텍스트에서 인용을 파싱해 별도 이벤트로 전송
      const answer = await result.text;
      const citations = extractCitations(answer, results);
      writer.write({ type: 'data-citations', data: citations });

      trace.answer = answer;
      trace.citedSources = citations.map((c) => c.number);
      trace.latencyMs.generation = Date.now() - generationStart;
      trace.latencyMs.total = Date.now() - totalStart;
      try {
        saveTrace(trace);
      } catch (err) {
        logger.warn('트레이스 저장 실패', String(err));
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
