import { config } from '@/config';
import type { Embedder } from '@minutes/core';

// 색인(청크 임베딩)과 검색(질의 임베딩)이 함께 쓴다.
//
// 12단계 — 한시적으로 Gemini API(gemini-embedding-001, 768차원)를 사용한다.
// Gemini 전용 로직(요청 형식, 인증 헤더, 429 처리)은 전부 이 파일 안에만 둔다.
// 호출부는 Embedder 인터페이스만 보므로, Ollama로 되돌릴 때 이 파일만 교체하면 된다.
// (이전 Ollama 구현은 git 히스토리 참조 — POST {OLLAMA_BASE_URL}/api/embed)

/** 쿼터 초과(429). 즉시 재시도해도 다시 걸리므로 일반 오류와 구분한다. */
export class RateLimitError extends Error {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

interface GeminiEmbedderOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  rateLimitDelayMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface BatchEmbedResponse {
  embeddings?: { values: number[] }[];
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createGeminiEmbedder(options: GeminiEmbedderOptions): Embedder {
  const {
    apiKey,
    fetchImpl = fetch,
    retryDelayMs = config.embedding.retryDelayMs,
    rateLimitDelayMs = config.embedding.rateLimitDelayMs,
    maxRetries = config.embedding.maxRetries,
    sleep = defaultSleep,
  } = options;

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY가 설정되지 않았습니다. ' +
        'https://aistudio.google.com/apikey 에서 발급해 서버 .env에 넣으세요.'
    );
  }

  const endpoint = `${config.embedding.baseUrl}/models/${config.embedding.model}:batchEmbedContents`;

  async function callBatch(batch: string[]): Promise<number[][]> {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: `models/${config.embedding.model}`,
          content: { parts: [{ text }] },
          outputDimensionality: config.embedding.dimension,
        })),
      }),
    }).catch((err) => {
      throw new Error(`Gemini API에 연결할 수 없습니다. 원인: ${err}`);
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new RateLimitError(
        'Gemini 임베딩 쿼터를 초과했습니다 (429). 한도가 회복된 뒤 색인을 재개하세요.',
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined
      );
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini 임베딩 호출 실패 (${res.status}): ${body}`);
    }

    const { embeddings } = (await res.json()) as BatchEmbedResponse;
    if (!embeddings || embeddings.length !== batch.length) {
      throw new Error(
        `Gemini 응답의 임베딩 개수가 요청과 다릅니다 (요청 ${batch.length}, 응답 ${embeddings?.length ?? 0}).`
      );
    }
    return embeddings.map((e) => e.values);
  }

  async function embedBatchWithRetry(batch: string[]): Promise<number[][]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await callBatch(batch);
      } catch (err) {
        lastError = err;
        if (attempt === maxRetries - 1) break;
        // 429는 지수 백오프로 회복되지 않는다 — 별도의 긴 대기를 준다.
        const wait =
          err instanceof RateLimitError
            ? (err.retryAfterMs ?? rateLimitDelayMs)
            : 2 ** attempt * retryDelayMs;
        await sleep(wait);
      }
    }
    throw lastError;
  }

  return {
    dimension: config.embedding.dimension,

    async embed(texts: string[]): Promise<number[][]> {
      const vectors: number[][] = [];
      for (let i = 0; i < texts.length; i += config.embedding.batchSize) {
        const batch = texts.slice(i, i + config.embedding.batchSize);
        vectors.push(...(await embedBatchWithRetry(batch)));
      }
      return vectors;
    },
  };
}

/**
 * /health용 임베딩 백엔드 확인.
 * 모델 메타데이터만 조회하므로 임베딩 쿼터를 쓰지 않는다.
 * (Ollama 복귀 시 GET {OLLAMA_BASE_URL}/api/tags 로 바꾸면 된다)
 */
export async function checkEmbedding(fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${config.embedding.baseUrl}/models/${config.embedding.model}`, {
    headers: { 'x-goog-api-key': config.embedding.geminiApiKey },
  });
  if (!res.ok) throw new Error(`Gemini 임베딩 API 응답 오류 (${res.status})`);
}

// API 키가 없으면 여기서 실패해 서버가 기동되지 않는다.
export const embedder: Embedder = createGeminiEmbedder({
  apiKey: config.embedding.geminiApiKey,
});
