import { describe, expect, it } from 'vitest';
import type { NotionConnection } from '@/oauth/connections';
import type { IndexingResult } from './indexer';
import { runScheduledSync } from './scheduler';

function connection(id: string): NotionConnection {
  return { id, status: 'connected' } as NotionConnection;
}

function okResult(): IndexingResult {
  return { mode: 'incremental', total: 0, indexed: 0, skipped: 0, failed: 0, deleted: 0, deletionSweep: { performed: false } };
}

describe('runScheduledSync', () => {
  it('이전 회차가 끝나지 않은 연결은 건너뛴다', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const deps = {
      listConnections: () => [connection('sched-conn-1')],
      index: async () => {
        calls++;
        await gate;
        return okResult();
      },
    };

    runScheduledSync(deps);
    runScheduledSync(deps); // 첫 회차가 아직 실행 중

    expect(calls).toBe(1);

    release();
    await new Promise((r) => setTimeout(r, 0));
    runScheduledSync(deps); // 끝난 뒤에는 다시 실행된다
    expect(calls).toBe(2);
    release();
  });
});
