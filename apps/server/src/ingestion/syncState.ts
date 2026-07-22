import { db } from '@/db';

const LAST_SYNC_KEY = 'last_synced_at';

export async function getLastSyncTime(): Promise<Date> {
  const row = db().prepare('SELECT value FROM sync_state WHERE key = ?').get(LAST_SYNC_KEY) as
    | { value: string }
    | undefined;
  return row ? new Date(row.value) : new Date(0);
}

export async function setLastSyncTime(date: Date): Promise<void> {
  db()
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(LAST_SYNC_KEY, date.toISOString(), new Date().toISOString());
}
