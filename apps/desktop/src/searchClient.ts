import type { SearchResult } from '@minutes/core';
import { config } from '@/config';
import { serverFetch } from '@/serverFetch';
import { getAppToken } from '@/notionAuth';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface SearchClient {
  search(query: string, topK?: number): Promise<SearchResult[]>;
}

/** 중앙 서버 /search HTTP 클라이언트 — 앱 토큰(Bearer)으로 사용자를 증명한다. */
export function createSearchClient(
  baseUrl: string,
  fetchFn: FetchLike = serverFetch,
  getToken: () => string | null = getAppToken
): SearchClient {
  return {
    async search(query, topK) {
      const token = getToken();
      const res = await fetchFn(`${baseUrl}/search`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
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
