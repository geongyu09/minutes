import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/config';
import { createNotionClient } from './client';

/** 임의의 1초 구간에 몰린 최대 호출 수 */
function maxPerSecond(timestamps: number[]): number {
  return timestamps.reduce((max, start) => {
    const inWindow = timestamps.filter((t) => t >= start && t < start + 1000).length;
    return Math.max(max, inWindow);
  }, 0);
}

describe('createNotionClient — 속도 제한', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('동시에 넣은 호출도 1초당 requestsPerSecond를 넘지 않는다', async () => {
    vi.useFakeTimers();
    const { throttled } = createNotionClient('token-a');
    const calledAt: number[] = [];

    const all = Promise.all(
      Array.from({ length: 10 }, () =>
        throttled(async () => {
          calledAt.push(Date.now());
        })
      )
    );
    await vi.runAllTimersAsync();
    await all;

    expect(calledAt).toHaveLength(10);
    expect(maxPerSecond(calledAt)).toBeLessThanOrEqual(config.notion.requestsPerSecond);
  });

  it('직렬화하지 않는다 — RTT가 처리량 상한이 되지 않는다', async () => {
    vi.useFakeTimers();
    const { throttled } = createNotionClient('token-a');
    let maxInFlight = 0;
    let inFlight = 0;

    // RTT 500ms — 직렬이면 초당 2회가 상한이고 동시 실행이 0건이어야 한다
    const all = Promise.all(
      Array.from({ length: 3 }, () =>
        throttled(async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 500));
          inFlight--;
        })
      )
    );
    await vi.runAllTimersAsync();
    await all;

    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('연결(토큰)마다 속도 예산이 따로다', async () => {
    vi.useFakeTimers();
    const a = createNotionClient('token-a');
    const b = createNotionClient('token-b');
    const startedAt = Date.now();
    const calledAtB: number[] = [];

    // A가 예산을 소진해도 B의 첫 호출은 기다리지 않아야 한다
    const all = Promise.all([
      ...Array.from({ length: 9 }, () => a.throttled(async () => {})),
      b.throttled(async () => {
        calledAtB.push(Date.now() - startedAt);
      }),
    ]);
    await vi.runAllTimersAsync();
    await all;

    expect(calledAtB).toEqual([0]);
  });

  it('429가 나면 동시성을 일시적으로 1로 낮춘다', async () => {
    vi.useFakeTimers();
    const { throttled } = createNotionClient('token-a');

    // 재시도로 성공하는 429 한 번 — 여기서 동시성이 낮아진다
    let first = true;
    const warmup = throttled(async () => {
      if (first) {
        first = false;
        throw Object.assign(new Error('rate limited'), { status: 429 });
      }
    });
    await vi.runAllTimersAsync();
    await warmup;

    let inFlight = 0;
    let maxInFlight = 0;
    const all = Promise.all(
      Array.from({ length: 3 }, () =>
        throttled(async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 500));
          inFlight--;
        })
      )
    );
    await vi.runAllTimersAsync();
    await all;

    expect(maxInFlight).toBe(1);
  });
});

describe('createNotionClient — 재시도', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('재시도 소진 시 마지막 오류를 cause와 status로 보존한다', async () => {
    vi.useFakeTimers();
    const { throttled } = createNotionClient('token-a');
    const original = Object.assign(new Error('rate limited'), { status: 429 });

    const promise = throttled(() => Promise.reject(original));
    const assertion = expect(promise).rejects.toMatchObject({ status: 429, cause: original });
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('재시도 대상이 아닌 오류(401)는 즉시 원본 그대로 던진다', async () => {
    vi.useFakeTimers();
    const { throttled } = createNotionClient('token-a');
    const original = Object.assign(new Error('unauthorized'), { status: 401 });

    const promise = throttled(() => Promise.reject(original));
    const assertion = expect(promise).rejects.toBe(original);
    await vi.runAllTimersAsync();
    await assertion;
  });
});
