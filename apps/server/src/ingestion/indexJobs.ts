import { logger } from '@minutes/core';
import type { IndexingResult } from './indexer';

export interface IndexProgress {
  indexed: number;
  total: number;
}

export type IndexJobState =
  | { status: 'idle' }
  | { status: 'running'; mode: 'full' | 'incremental'; indexed: number; total: number }
  | { status: 'done'; result: IndexingResult; finishedAt: string }
  | { status: 'failed'; error: string; finishedAt: string };

// 연결별 색인 잡 상태 — 단일 프로세스이므로 메모리로 충분하다
const jobs = new Map<string, IndexJobState>();

export function getIndexJob(connectionId: string): IndexJobState {
  return jobs.get(connectionId) ?? { status: 'idle' };
}

/**
 * 색인을 백그라운드로 시작한다. 이미 실행 중이면 false를 반환하고 아무것도 하지 않는다 —
 * 같은 연결의 색인이 겹쳐 돌면 rate limit과 DB 쓰기가 충돌한다.
 */
export function startIndexJob(
  connectionId: string,
  mode: 'full' | 'incremental',
  run: (onProgress: (progress: IndexProgress) => void) => Promise<IndexingResult>
): boolean {
  if (getIndexJob(connectionId).status === 'running') return false;

  jobs.set(connectionId, { status: 'running', mode, indexed: 0, total: 0 });
  run((progress) => {
    jobs.set(connectionId, { status: 'running', mode, ...progress });
  })
    .then((result) => {
      jobs.set(connectionId, { status: 'done', result, finishedAt: new Date().toISOString() });
    })
    .catch((err) => {
      logger.error(`색인 잡 실패 (${connectionId})`, String(err));
      jobs.set(connectionId, {
        status: 'failed',
        error: String(err),
        finishedAt: new Date().toISOString(),
      });
    });
  return true;
}
