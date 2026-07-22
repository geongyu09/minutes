import { config } from '@/config';
import { logger } from '@minutes/core';
import { listConnected, type NotionConnection } from '@/oauth/connections';
import { indexConnectionWithRefresh, type IndexingResult } from './indexer';
import { startIndexJob, type IndexProgress } from './indexJobs';

// dev 재로딩에도 타이머가 중복 생성되지 않도록 globalThis에 플래그를 둔다
const FLAG = '__minutesIncrementalSyncStarted';

export interface SchedulerDeps {
  listConnections: () => NotionConnection[];
  index: (
    connection: NotionConnection,
    onProgress: (progress: IndexProgress) => void
  ) => Promise<IndexingResult>;
}

const defaultDeps: SchedulerDeps = {
  listConnections: listConnected,
  index: (connection, onProgress) =>
    indexConnectionWithRefresh(connection, 'incremental', onProgress),
};

/**
 * 한 회차의 증분 동기화 — 연결별 색인 잡을 시작한다.
 * 잡 상태가 running인 연결(이전 회차 미종료 또는 API로 시작된 색인)은 건너뛴다.
 */
export function runScheduledSync(deps: SchedulerDeps = defaultDeps): void {
  for (const connection of deps.listConnections()) {
    const started = startIndexJob(connection.id, 'incremental', (onProgress) =>
      deps.index(connection, onProgress)
    );
    if (!started) {
      logger.info(`증분 동기화 건너뜀 — 이미 색인 실행 중 (${connection.workspaceName ?? connection.id})`);
    }
  }
}

/** 서버 내 타이머 — 연결된 모든 사용자에 대해 주기적으로 증분 동기화를 실행한다. */
export function startIncrementalSync(): void {
  const g = globalThis as Record<string, unknown>;
  if (g[FLAG]) return;
  g[FLAG] = true;

  const timer = setInterval(() => runScheduledSync(), config.sync.intervalMs);
  timer.unref(); // 타이머가 프로세스 종료를 막지 않도록
}
