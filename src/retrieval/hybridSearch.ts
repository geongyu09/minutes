import { config } from '@/core/config';
import type { SearchResult } from '@/core/types';

/** Reciprocal Rank Fusion으로 두 검색 결과를 병합 — 점수가 아닌 순위만 사용한다. */
export function fuseResults(
  vectorResults: SearchResult[],
  keywordResults: SearchResult[],
  k = config.retrieval.rrfK
): SearchResult[] {
  const scores = new Map<string, { result: SearchResult; score: number }>();

  const add = (results: SearchResult[], weight: number) => {
    results.forEach((result, rank) => {
      const rrf = weight / (k + rank + 1);
      const existing = scores.get(result.chunk.id);
      if (existing) {
        existing.score += rrf;
      } else {
        scores.set(result.chunk.id, { result: { ...result, source: 'hybrid' }, score: rrf });
      }
    });
  };

  add(vectorResults, config.retrieval.vectorWeight);
  add(keywordResults, config.retrieval.keywordWeight);

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, score }));
}
