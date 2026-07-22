import { config } from '@/config';
import { logger } from '@minutes/core';
import { runIndexing } from './indexer';

// dev 재로딩에도 타이머가 중복 생성되지 않도록 globalThis에 플래그를 둔다
const FLAG = '__minutesIncrementalSyncStarted';

/** 서버 내 타이머 — 연결된 모든 사용자에 대해 주기적으로 증분 동기화를 실행한다. */
export function startIncrementalSync(): void {
  const g = globalThis as Record<string, unknown>;
  if (g[FLAG]) return;
  g[FLAG] = true;

  const timer = setInterval(() => {
    runIndexing('incremental')
      .then((r) =>
        logger.info(`증분 동기화 — 연결 ${r.connections}건, 대상 ${r.total}건, 성공 ${r.indexed}건`)
      )
      .catch((err) => logger.error('증분 동기화 실패', String(err)));
  }, config.sync.intervalMs);
  timer.unref(); // 타이머가 프로세스 종료를 막지 않도록
}
