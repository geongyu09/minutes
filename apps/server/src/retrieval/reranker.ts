import type { SearchResult } from '@minutes/core';

/**
 * 리랭커 — 미사용 (config.retrieval.useReranker = false).
 * 외부 API 의존을 제거하는 방침이라, 필요해지면 로컬 모델 기반으로 검토한다.
 * 현재는 결과를 그대로 통과시킨다.
 */
export async function rerank(
  _query: string,
  results: SearchResult[],
  topN: number
): Promise<SearchResult[]> {
  return results.slice(0, topN);
}
