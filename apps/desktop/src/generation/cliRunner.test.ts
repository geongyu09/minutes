import { describe, expect, it } from 'vitest';
import { createLineQueue } from './cliRunner';

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const line of iterable) out.push(line);
  return out;
}

describe('createLineQueue', () => {
  it('push된 줄을 순서대로 내놓고 close되면 종료한다', async () => {
    const queue = createLineQueue();
    queue.push('첫 줄');
    queue.push('둘째 줄');
    queue.close();

    expect(await collect(queue.lines)).toEqual(['첫 줄', '둘째 줄']);
  });

  it('소비 중에 늦게 push된 줄도 받는다', async () => {
    const queue = createLineQueue();
    const result = collect(queue.lines);

    queue.push('a');
    await Promise.resolve();
    queue.push('b');
    queue.close();

    expect(await result).toEqual(['a', 'b']);
  });

  it('fail되면 남은 줄을 내놓은 뒤 오류를 던진다', async () => {
    const queue = createLineQueue();
    queue.push('마지막 출력');
    queue.fail(new Error('spawn 실패'));

    const iterator = queue.lines[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toBe('마지막 출력');
    await expect(iterator.next()).rejects.toThrow('spawn 실패');
  });

  it('close 이후의 push는 무시한다', async () => {
    const queue = createLineQueue();
    queue.push('유효');
    queue.close();
    queue.push('무시됨');

    expect(await collect(queue.lines)).toEqual(['유효']);
  });
});
