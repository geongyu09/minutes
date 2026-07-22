import type { Retriever, SearchResult } from '@minutes/core';
import type { IndexJobState } from '@/ingestion/indexJobs';

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

export interface IndexDeps {
  clearCursor: () => Promise<void>;
  /** 백그라운드 잡 시작 — 이미 실행 중이면 false */
  start: () => boolean;
  getState: () => IndexJobState;
}

export interface IndexHandlerResult {
  status: number;
  body: { job: IndexJobState };
}

/**
 * POST /index — 색인은 시작만 하고 즉시 202를 반환한다 (색인 전체를 동기 응답으로 붙들면
 * 수백 건 규모에서 requestTimeout을 넘긴다). 이미 실행 중이면 409와 현재 상태.
 * full은 정의상 전체를 다시 훑으므로 커서를 리셋한 뒤 시작한다.
 */
export async function handleIndex(
  mode: 'full' | 'incremental',
  deps: IndexDeps
): Promise<IndexHandlerResult> {
  if (deps.getState().status === 'running') {
    return { status: 409, body: { job: deps.getState() } };
  }
  if (mode === 'full') await deps.clearCursor();
  if (!deps.start()) {
    return { status: 409, body: { job: deps.getState() } };
  }
  return { status: 202, body: { job: deps.getState() } };
}

/** GET /index/status — 데스크톱이 폴링해 진행률을 표시한다. */
export function handleIndexStatus(getState: () => IndexJobState): IndexHandlerResult {
  return { status: 200, body: { job: getState() } };
}
