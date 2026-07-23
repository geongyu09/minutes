import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit';

describe('createRateLimiter', () => {
  it('한도까지는 허용하고 넘으면 막는다', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => 0 });

    expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(false);
  });

  it('키(호출자)별로 따로 센다', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    limiter.allow('1.2.3.4');

    expect(limiter.allow('5.6.7.8')).toBe(true);
  });

  it('창이 지나면 다시 허용한다', () => {
    let clock = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => clock });
    limiter.allow('1.2.3.4');

    clock = 1001;

    expect(limiter.allow('1.2.3.4')).toBe(true);
  });
});
