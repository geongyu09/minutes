import OpenAI from 'openai';
import { config } from '@/core/config';
import type { Embedder } from '@/core/types';

// 색인(청크 임베딩)과 검색(질의 임베딩)이 함께 쓰므로 core에 둔다.
// 빌드 시점에는 API 키가 없을 수 있으므로 첫 사용 시점에 생성한다.
let instance: OpenAI | undefined;

function openaiClient(): OpenAI {
  if (!instance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY가 설정되지 않았습니다');
    }
    instance = new OpenAI({ apiKey });
  }
  return instance;
}

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

export const embedder: Embedder = {
  dimension: config.embedding.dimension,

  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += config.embedding.batchSize) {
      const batch = texts.slice(i, i + config.embedding.batchSize);
      const res = await withRetry(() =>
        openaiClient().embeddings.create({ model: config.embedding.model, input: batch })
      );
      vectors.push(...res.data.map((d) => d.embedding));
    }
    return vectors;
  },
};
