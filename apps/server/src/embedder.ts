import { config } from '@/config';
import type { Embedder } from '@minutes/core';

// 색인(청크 임베딩)과 검색(질의 임베딩)이 함께 쓰므로 core에 둔다.
// 로컬 Ollama의 /api/embed 엔드포인트를 사용한다.

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    }
  }
  throw lastError;
}

async function embedBatch(batch: string[]): Promise<number[][]> {
  const res = await fetch(`${config.embedding.ollamaBaseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.embedding.model, input: batch }),
  }).catch((err) => {
    throw new Error(
      `Ollama에 연결할 수 없습니다 (${config.embedding.ollamaBaseUrl}). ` +
        `Ollama를 실행한 뒤 다시 시도하세요. 원인: ${err}`
    );
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Ollama 임베딩 호출 실패 (${res.status}): ${body}. ` +
        `모델이 없다면 'ollama pull ${config.embedding.model}'을 실행하세요.`
    );
  }

  const { embeddings } = (await res.json()) as { embeddings: number[][] };
  return embeddings;
}

export const embedder: Embedder = {
  dimension: config.embedding.dimension,

  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += config.embedding.batchSize) {
      const batch = texts.slice(i, i + config.embedding.batchSize);
      vectors.push(...(await withRetry(() => embedBatch(batch))));
    }
    return vectors;
  },
};
