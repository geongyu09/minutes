import type { Citation, SearchResult } from '@/core/types';

/** LLM 답변의 [출처 N] 표기를 실제 출처 메타데이터로 매핑한다. 범위 밖 번호(환각)는 버린다. */
export function extractCitations(answer: string, sources: SearchResult[]): Citation[] {
  const used = new Set<number>();
  const pattern = /\[출처\s*(\d+)\]/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(answer)) !== null) {
    used.add(Number(match[1]));
  }

  return [...used]
    .filter((n) => n >= 1 && n <= sources.length)
    .sort((a, b) => a - b)
    .map((n) => {
      const meta = sources[n - 1].chunk.metadata;
      return {
        number: n,
        documentTitle: meta.documentTitle,
        documentUrl: meta.documentUrl,
        headingPath: meta.headingPath,
      };
    });
}
