import { Client } from '@notionhq/client';
import pLimit from 'p-limit';
import { config } from '@/config';

const limit = pLimit(1);
let lastCallAt = 0;

export const notion = new Client({ auth: config.notion.apiKey });

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** rate limit(초당 3회)을 지키며 노션 API를 호출. 429/5xx는 지수 백오프로 재시도. */
export async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  return limit(async () => {
    const gap = 1000 / config.notion.requestsPerSecond;
    const wait = Math.max(0, lastCallAt + gap - Date.now());
    if (wait > 0) await sleep(wait);

    for (let attempt = 0; attempt < config.notion.maxRetries; attempt++) {
      try {
        lastCallAt = Date.now();
        return await fn();
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status ?? 0;
        if (status !== 429 && status < 500) throw err;
        const backoff = Math.min(2 ** attempt * 1000, 30_000);
        await sleep(backoff);
      }
    }
    throw new Error('노션 API 재시도 횟수를 초과했습니다.');
  });
}
