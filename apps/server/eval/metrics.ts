import type { SearchResult } from '@minutes/core';

/** 상위 k개 결과에 정답 문서가 얼마나 포함됐는지 (0~1). */
export function recallAtK(results: SearchResult[], expected: string[], k: number): number {
  const retrieved = new Set(results.slice(0, k).map((r) => r.chunk.documentId));
  const hits = expected.filter((id) => retrieved.has(id)).length;
  return expected.length === 0 ? 1 : hits / expected.length;
}
