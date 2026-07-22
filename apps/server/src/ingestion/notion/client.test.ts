import { afterEach, describe, expect, it, vi } from 'vitest';
import { throttled } from './client';

describe('throttled', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('재시도 소진 시 마지막 오류를 cause와 status로 보존한다', async () => {
    vi.useFakeTimers();
    const original = Object.assign(new Error('rate limited'), { status: 429 });

    const promise = throttled(() => Promise.reject(original));
    const assertion = expect(promise).rejects.toMatchObject({ status: 429, cause: original });
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('재시도 대상이 아닌 오류(401)는 즉시 원본 그대로 던진다', async () => {
    vi.useFakeTimers();
    const original = Object.assign(new Error('unauthorized'), { status: 401 });

    const promise = throttled(() => Promise.reject(original));
    const assertion = expect(promise).rejects.toBe(original);
    await vi.runAllTimersAsync();
    await assertion;
  });
});
