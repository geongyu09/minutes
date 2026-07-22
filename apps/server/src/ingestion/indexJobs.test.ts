import { describe, expect, it } from 'vitest';
import type { IndexingResult } from './indexer';
import { getIndexJob, startIndexJob, type IndexProgress } from './indexJobs';

function okResult(): IndexingResult {
  return { mode: 'full', total: 2, indexed: 2, failed: 0, deleted: 0 };
}

/** run이 신호를 받을 때까지 완료되지 않게 잡아둔다 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe('indexJobs', () => {
  it('시작 전에는 idle 상태다', () => {
    expect(getIndexJob('conn-none')).toEqual({ status: 'idle' });
  });

  it('시작하면 running, 완료되면 done + 결과가 된다', async () => {
    const gate = deferred<IndexingResult>();
    const started = startIndexJob('conn-1', 'full', () => gate.promise);

    expect(started).toBe(true);
    expect(getIndexJob('conn-1').status).toBe('running');

    gate.resolve(okResult());
    await flush();

    const state = getIndexJob('conn-1');
    expect(state.status).toBe('done');
    expect(state.status === 'done' && state.result.indexed).toBe(2);
  });

  it('실행 중이면 새 잡 시작을 거부한다', async () => {
    const gate = deferred<IndexingResult>();
    startIndexJob('conn-2', 'full', () => gate.promise);

    expect(startIndexJob('conn-2', 'incremental', async () => okResult())).toBe(false);

    gate.resolve(okResult());
    await flush();
    // 끝난 뒤에는 다시 시작할 수 있다
    expect(startIndexJob('conn-2', 'incremental', async () => okResult())).toBe(true);
  });

  it('run이 던지면 failed 상태와 오류 메시지를 남긴다', async () => {
    startIndexJob('conn-3', 'full', async () => {
      throw new Error('색인 폭발');
    });
    await flush();

    const state = getIndexJob('conn-3');
    expect(state.status).toBe('failed');
    expect(state.status === 'failed' && state.error).toContain('색인 폭발');
  });

  it('onProgress 콜백으로 진행률이 갱신된다', async () => {
    const gate = deferred<IndexingResult>();
    let report!: (p: IndexProgress) => void;
    startIndexJob('conn-4', 'full', (onProgress) => {
      report = onProgress;
      return gate.promise;
    });

    report({ indexed: 1, total: 5 });
    const state = getIndexJob('conn-4');
    expect(state.status === 'running' && state.indexed).toBe(1);
    expect(state.status === 'running' && state.total).toBe(5);

    gate.resolve(okResult());
    await flush();
  });
});
