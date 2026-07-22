import type { SearchResult } from '@/core/types';

/**
 * 리랭커 — MVP에서는 미사용 (config.retrieval.useReranker = false).
 * Recall@8이 목표(0.8)에 못 미칠 때만 Cohere Rerank 등을 붙인다.
 * 현재는 결과를 그대로 통과시킨다.
 */
export async function rerank(
  _query: string,
  results: SearchResult[],
  topN: number
): Promise<SearchResult[]> {
  return results.slice(0, topN);
}
