import { config } from '@/config';
import type { Message } from '@minutes/core';
import { complete } from './llmClient';

const REWRITE_PROMPT = `이전 대화를 참고해서, 마지막 질문을 그 자체로 이해 가능한 완전한 문장으로 바꾸세요.
대명사나 생략된 주어를 앞 대화의 내용으로 채웁니다.
바꿀 필요가 없으면 원문을 그대로 출력합니다.
설명 없이 바뀐 질문만 출력합니다.`;

export async function rewriteQuery(query: string, history: Message[]): Promise<string> {
  if (history.length === 0) return query; // 첫 질문은 재작성 불필요

  const recent = history.slice(-config.generation.historyTurns * 2);
  const historyText = recent
    .map((m) => `${m.role === 'user' ? '사용자' : '어시스턴트'}: ${m.content}`)
    .join('\n');

  const text = await complete({
    systemPrompt: REWRITE_PROMPT,
    userMessage: `이전 대화:\n${historyText}\n\n마지막 질문: ${query}`,
    sources: [],
  });

  return text.trim() || query;
}
