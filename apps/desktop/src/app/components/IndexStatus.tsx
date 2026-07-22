'use client';

import { useCallback, useEffect, useState } from 'react';

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

export function IndexStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [indexing, setIndexing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) setStatus(await res.json());
    } catch {
      // 상태 표시는 부가 기능 — 실패해도 채팅은 동작한다
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reindex = async () => {
    setIndexing(true);
    try {
      await fetch('/api/index?mode=incremental', { method: 'POST' });
      await load();
    } finally {
      setIndexing(false);
    }
  };

  return (
    <div className="index-status">
      {status && (
        <span>
          문서 {status.documentCount} · 청크 {status.chunkCount} · {formatTime(status.lastSyncedAt)}
        </span>
      )}
      <button onClick={reindex} disabled={indexing}>
        {indexing ? '색인 중…' : '재색인'}
      </button>
    </div>
  );
}
