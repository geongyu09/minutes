import { Client } from '@notionhq/client';
import { config } from '@/config';

/**
 * 연결(액세스 토큰)마다 하나. 클라이언트와 그 연결 전용 속도 예산을 함께 묶는다.
 * 노션 rate limit은 통합(봇) 단위이므로 워크스페이스가 다르면 예산도 따로다 —
 * 예산을 모듈 전역에 두면 두 팀이 동시에 색인할 때 서로의 속도를 깎는다.
 */
export interface ThrottledClient {
  client: Client;
  throttled<T>(fn: () => Promise<T>): Promise<T>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 한도를 실행 중에 바꿀 수 있는 동시 실행 제한기 — 429가 나면 낮춘다. */
function createSemaphore(initialLimit: number) {
  let limit = initialLimit;
  let active = 0;
  const waiting: (() => void)[] = [];

  const pump = () => {
    while (active < limit && waiting.length > 0) {
      active++;
      waiting.shift()!();
    }
  };

  return {
    setLimit(next: number) {
      limit = Math.max(1, next);
      pump();
    },
    acquire(): Promise<void> {
      return new Promise<void>((resolve) => {
        waiting.push(resolve);
        pump();
      });
    },
    release() {
      active--;
      pump();
    },
  };
}

/**
 * 토큰 버킷. 용량을 1로 두어 버스트를 막는다 —
 * 용량을 requestsPerSecond로 두면 임의의 1초 구간에 최대 2배가 몰려 429를 부른다.
 */
function createTokenBucket(ratePerSecond: number) {
  // 정수 ms로 올림한다 — 소수 간격은 Date.now()의 ms 단위와 어긋나 1초 구간에 한 건이 더 몰린다
  const intervalMs = Math.ceil(1000 / ratePerSecond);
  let nextAvailableAt = 0;

  return async function take(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, nextAvailableAt);
    nextAvailableAt = at + intervalMs;
    if (at > now) await sleep(at - now);
  };
}

/** OAuth로 발급받은 액세스 토큰으로 노션 클라이언트와 전용 스로틀러를 만든다. */
export function createNotionClient(accessToken: string): ThrottledClient {
  const { requestsPerSecond, concurrency, maxRetries, rateLimitCooldownMs } = config.notion;
  const semaphore = createSemaphore(concurrency);
  const take = createTokenBucket(requestsPerSecond);
  // 429를 만나면 동시성을 1로 낮추고, 잠잠해지면 되돌린다 (3 req/s는 평균 기준이라 버스트에서 걸린다)
  let throttledUntil = 0;

  const noteRateLimited = () => {
    throttledUntil = Date.now() + rateLimitCooldownMs;
    semaphore.setLimit(1);
  };
  const restoreIfCalm = () => {
    if (throttledUntil > 0 && Date.now() >= throttledUntil) {
      throttledUntil = 0;
      semaphore.setLimit(concurrency);
    }
  };

  async function throttled<T>(fn: () => Promise<T>): Promise<T> {
    restoreIfCalm();
    await semaphore.acquire();
    try {
      let lastErr: unknown;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        await take();
        try {
          return await fn();
        } catch (err: unknown) {
          const status = (err as { status?: number })?.status ?? 0;
          if (status !== 429 && status < 500) throw err;
          if (status === 429) noteRateLimited();
          lastErr = err;
          await sleep(Math.min(2 ** attempt * 1000, 30_000));
        }
      }
      // 원래 오류(상태 코드)를 보존한다 — 색인의 중단 오류 판정(401·429 구분)이 이 정보에 의존한다
      throw Object.assign(new Error('노션 API 재시도 횟수를 초과했습니다.', { cause: lastErr }), {
        status: (lastErr as { status?: number })?.status,
      });
    } finally {
      semaphore.release();
    }
  }

  return { client: new Client({ auth: accessToken }), throttled };
}
