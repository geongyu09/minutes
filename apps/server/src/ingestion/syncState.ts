import { db } from '@/db';

// 동기화 시각은 연결(사용자)별로 기록한다
function syncKey(connectionId: string): string {
  return `last_synced_at:${connectionId}`;
}

export async function getLastSyncTime(connectionId: string): Promise<Date> {
  const row = db()
    .prepare('SELECT value FROM sync_state WHERE key = ?')
    .get(syncKey(connectionId)) as { value: string } | undefined;
  return row ? new Date(row.value) : new Date(0);
}

export async function setLastSyncTime(connectionId: string, date: Date): Promise<void> {
  db()
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(syncKey(connectionId), date.toISOString(), new Date().toISOString());
}
