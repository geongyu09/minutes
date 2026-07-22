'use client';

import { useCallback, useEffect, useState } from 'react';
import { config } from '@/config';
import { serverFetch } from '@/serverFetch';
import { authHeaders } from '@/notionAuth';
import { indexClient, type IndexJob, type ReindexResult } from '@/indexClient';

interface Status {
  documentCount: number;
  chunkCount: number;
  lastSyncedAt: string;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (date.getTime() === 0) return '동기화 전';
  return date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

function abortedMessage(aborted: NonNullable<ReindexResult['aborted']>): string {
  return aborted.reason === 'rate_limit'
    ? '임베딩 쿼터 초과로 중단되었습니다. 잠시 후 다시 시도하세요.'
    : '노션 인증이 만료되어 중단되었습니다. 노션을 다시 연결하세요.';
}

function noticeFrom(job: IndexJob): string | null {
  if (job.status === 'failed') return '색인에 실패했습니다. 서버 로그를 확인하세요.';
  if (job.status === 'done' && job.result.aborted) return abortedMessage(job.result.aborted);
  return null;
}

export function IndexStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [job, setJob] = useState<IndexJob | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await serverFetch(`${config.server.baseUrl}/status`, { headers: authHeaders() });
      if (res.ok) setStatus(await res.json());
    } catch {
      // 상태 표시는 부가 기능 — 실패해도 채팅은 동작한다
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 실행 중인 잡을 폴링해 진행률을 갱신하고, 끝나면 결과를 안내한다
  useEffect(() => {
    if (job?.status !== 'running') return;
    const timer = setInterval(async () => {
      try {
        const next = await indexClient.getIndexJob();
        setJob(next);
        if (next.status !== 'running') {
          setNotice(noticeFrom(next));
          await load();
        }
      } catch {
        // 일시적 폴링 실패는 다음 주기에 다시 시도한다
      }
    }, config.indexing.pollIntervalMs);
    return () => clearInterval(timer);
  }, [job?.status, load]);

  const reindex = async (mode: 'full' | 'incremental') => {
    setNotice(null);
    try {
      setJob(await indexClient.startReindex(mode));
    } catch {
      setNotice('색인 요청에 실패했습니다. 서버 상태를 확인하세요.');
    }
  };

  const indexing = job?.status === 'running';

  return (
    <div className="index-status">
      {status && (
        <span>
          문서 {status.documentCount} · 청크 {status.chunkCount} · {formatTime(status.lastSyncedAt)}
        </span>
      )}
      <button onClick={() => reindex('incremental')} disabled={indexing}>
        {job?.status === 'running'
          ? `색인 중… ${job.indexed}/${job.total || '?'}`
          : '재색인'}
      </button>
      <button
        onClick={() => reindex('full')}
        disabled={indexing}
        title="모든 문서를 처음부터 다시 색인합니다 — 문서가 많으면 오래 걸립니다"
      >
        전체 재색인
      </button>
      {notice && <span className="index-notice">{notice}</span>}
    </div>
  );
}
