import type { SearchResult } from '@minutes/core';
import { config } from '@/config';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface SearchClient {
  search(query: string, topK?: number): Promise<SearchResult[]>;
}

/** 중앙 서버 /search HTTP 클라이언트 — 앱은 검색 내부(임베딩·벡터 DB)를 모른다. */
export function createSearchClient(baseUrl: string, fetchFn: FetchLike = fetch): SearchClient {
  return {
    async search(query, topK) {
      const res = await fetchFn(`${baseUrl}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(topK !== undefined ? { query, topK } : { query }),
      });
      if (!res.ok) {
        throw new Error(`검색 서버 오류 (${res.status}): ${await res.text()}`);
      }
      const { results } = (await res.json()) as { results: SearchResult[] };
      return results;
    },
  };
}

export const searchClient = createSearchClient(config.server.baseUrl);
