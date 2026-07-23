/**
 * 고정 창 레이트 리미터 (인메모리).
 * 로그인·인가 시작처럼 인증 없이 열려 있는 엔드포인트를 무한정 두드리지 못하게 한다
 * (rules/security.md — 모든 엔드포인트에 레이트 리미팅).
 */
export interface RateLimiter {
  allow(key: string): boolean;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

export function createRateLimiter({ limit, windowMs, now = Date.now }: RateLimiterOptions): RateLimiter {
  const windows = new Map<string, { startedAt: number; count: number }>();

  return {
    allow(key) {
      const at = now();
      const current = windows.get(key);

      if (!current || at - current.startedAt >= windowMs) {
        // 창이 바뀔 때마다 만료된 키를 함께 정리한다 (무제한 누적 방지)
        for (const [k, w] of windows) if (at - w.startedAt >= windowMs) windows.delete(k);
        windows.set(key, { startedAt: at, count: 1 });
        return true;
      }
      if (current.count >= limit) return false;

      current.count += 1;
      return true;
    },
  };
}
