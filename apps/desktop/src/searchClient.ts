import type { SearchResult } from '@minutes/core';
import { config } from '@/config';
import { serverFetch } from '@/serverFetch';
import { getAppToken, getProjectId } from '@/session';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface SearchClient {
  search(query: string, topK?: number): Promise<SearchResult[]>;
}

/**
 * 중앙 서버 /search HTTP 클라이언트.
 * 앱 토큰(Bearer)으로 사용자를, `projectId`로 검색할 색인을 특정한다 — 서버가 멤버십을 검사한다.
 */
export function createSearchClient(
  baseUrl: string,
  fetchFn: FetchLike = serverFetch,
  getToken: () => string | null = getAppToken,
  getProject: () => string | null = getProjectId
): SearchClient {
  return {
    async search(query, topK) {
      const token = getToken();
      const projectId = getProject();
      if (!projectId) throw new Error('선택된 프로젝트가 없습니다');
      const res = await fetchFn(`${baseUrl}/search?projectId=${encodeURIComponent(projectId)}`, {
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
