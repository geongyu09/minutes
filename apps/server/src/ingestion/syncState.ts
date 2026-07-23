import { db } from '@/db';

// 동기화 시각은 연결(사용자)별로 기록한다
function syncKey(connectionId: string): string {
  return `last_synced_at:${connectionId}`;
}

// 삭제 정리는 전체 목록을 받은 회차에서만 한다 — 마지막 수행 시각과 그 뒤 회차 수를 남긴다.
// 조용한 지연은 조용한 누락과 같다: 이 값이 색인 결과에 실려 사용자에게 드러난다.
function sweptAtKey(connectionId: string): string {
  return `last_swept_at:${connectionId}`;
}

function runsSinceSweepKey(connectionId: string): string {
  return `runs_since_sweep:${connectionId}`;
}

function readValue(key: string): string | undefined {
  const row = db().prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function writeValue(key: string, value: string): void {
  db()
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, new Date().toISOString());
}

/** 마지막 삭제 정리 이후 지난 회차 수 */
export async function getRunsSinceSweep(connectionId: string): Promise<number> {
  return Number(readValue(runsSinceSweepKey(connectionId)) ?? 0);
}

export async function bumpRunsSinceSweep(connectionId: string): Promise<void> {
  writeValue(runsSinceSweepKey(connectionId), String((await getRunsSinceSweep(connectionId)) + 1));
}

/** 삭제 정리를 수행했음을 기록한다 — 회차 카운터를 0으로 되돌린다. */
export async function recordDeletionSweep(connectionId: string, at: Date): Promise<void> {
  writeValue(sweptAtKey(connectionId), at.toISOString());
  writeValue(runsSinceSweepKey(connectionId), '0');
}

export async function getLastSweepTime(connectionId: string): Promise<Date | undefined> {
  const value = readValue(sweptAtKey(connectionId));
  return value ? new Date(value) : undefined;
}

export async function getLastSyncTime(connectionId: string): Promise<Date> {
  const row = db()
    .prepare('SELECT value FROM sync_state WHERE key = ?')
    .get(syncKey(connectionId)) as { value: string } | undefined;
  return row ? new Date(row.value) : new Date(0);
}

/** 연결 변경으로 색인 데이터를 폐기할 때 동기화 시각도 함께 되돌린다 — 다음 색인이 전체 색인이 된다. */
export async function clearLastSyncTime(connectionId: string): Promise<void> {
  const clear = db().prepare('DELETE FROM sync_state WHERE key = ?');
  clear.run(syncKey(connectionId));
  clear.run(sweptAtKey(connectionId));
  clear.run(runsSinceSweepKey(connectionId));
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
