import type { PromptContext, SearchResult } from '@/core/types';

const SYSTEM_PROMPT = `당신은 팀 문서를 찾아주는 어시스턴트입니다.

규칙:
1. 아래 제공된 문서 내용 안에서만 답합니다. 문서에 없는 내용은 추측하지 않습니다.
2. 답변의 각 문장 끝에 근거가 된 출처 번호를 [출처 1] 형태로 답니다.
3. 여러 출처가 근거라면 [출처 1][출처 3]처럼 나열합니다.
4. 문서에서 답을 찾을 수 없으면 "제공된 문서에서 관련 내용을 찾지 못했습니다"라고 답하고,
   어떤 문서를 확인해봤는지 알려줍니다.
5. 문서 내용이 서로 다르면 양쪽을 모두 제시하고 어느 쪽이 더 최근인지 표시합니다.
6. 답변은 간결하게 씁니다.`;

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function buildPrompt(query: string, results: SearchResult[]): PromptContext {
  const sourceBlocks = results.map((r, i) => {
    const path = r.chunk.metadata.headingPath.join(' > ');
    return [
      `[출처 ${i + 1}]`,
      `문서: ${r.chunk.metadata.documentTitle}`,
      path ? `위치: ${path}` : '',
      `최종 수정: ${formatDate(r.chunk.metadata.lastEditedTime)}`,
      '---',
      r.chunk.content,
    ]
      .filter(Boolean)
      .join('\n');
  });

  const userMessage = [
    '다음 문서들을 참고해서 질문에 답하세요.',
    '',
    sourceBlocks.join('\n\n===\n\n'),
    '',
    `질문: ${query}`,
  ].join('\n');

  return { systemPrompt: SYSTEM_PROMPT, userMessage, sources: results };
}
