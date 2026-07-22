import type { Retriever, SearchResult } from '@minutes/core';

export interface SearchResponseBody {
  results?: SearchResult[];
  tookMs?: number;
  error?: string;
}

export interface HandlerResult {
  status: number;
  body: SearchResponseBody;
}

export interface HealthDeps {
  checkDb: () => Promise<void>;
  checkEmbedding: () => Promise<void>;
}

export interface HealthResult {
  status: number;
  body: { status: 'ok' | 'error'; db: string; embedding: string };
}

/** GET /health — DB·임베딩 API 연결을 확인한다. 하나라도 실패하면 503. */
export async function handleHealth(deps: HealthDeps): Promise<HealthResult> {
  const check = async (fn: () => Promise<void>): Promise<string> => {
    try {
      await fn();
      return 'ok';
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  const [db, embedding] = await Promise.all([check(deps.checkDb), check(deps.checkEmbedding)]);
  const healthy = db === 'ok' && embedding === 'ok';
  return { status: healthy ? 200 : 503, body: { status: healthy ? 'ok' : 'error', db, embedding } };
}

const MAX_TOP_K = 50;

/** POST /search 본문 처리 — HTTP 계층과 분리해 단위 테스트한다. */
export async function handleSearch(body: unknown, retriever: Retriever): Promise<HandlerResult> {
  const { query, topK } = (body ?? {}) as { query?: unknown; topK?: unknown };

  if (typeof query !== 'string' || query.trim().length === 0) {
    return { status: 400, body: { error: 'query는 비어 있지 않은 문자열이어야 합니다' } };
  }
  if (topK !== undefined && (typeof topK !== 'number' || !Number.isInteger(topK) || topK < 1 || topK > MAX_TOP_K)) {
    return { status: 400, body: { error: `topK는 1~${MAX_TOP_K} 사이의 정수여야 합니다` } };
  }

  const t0 = Date.now();
  const results = await retriever.retrieve(query.trim(), topK !== undefined ? { topK } : undefined);
  return { status: 200, body: { results, tookMs: Date.now() - t0 } };
}
