import { sql } from '@/core/db';

const LAST_SYNC_KEY = 'last_synced_at';

export async function getLastSyncTime(): Promise<Date> {
  const rows = await sql`SELECT value FROM sync_state WHERE key = ${LAST_SYNC_KEY}`;
  return rows.length > 0 ? new Date(rows[0].value) : new Date(0);
}

export async function setLastSyncTime(date: Date): Promise<void> {
  await sql`
    INSERT INTO sync_state (key, value, updated_at)
    VALUES (${LAST_SYNC_KEY}, ${date.toISOString()}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}
