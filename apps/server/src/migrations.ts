import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

/** db/migrations/*.sql을 순서대로 실행한다. 실행 이력은 schema_migrations 테이블로 관리. */
export function applyMigrations(database: Database.Database, log: (msg: string) => void = () => {}): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  const dir = path.join(process.cwd(), 'db', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (database.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map(
      (r) => r.name
    )
  );

  for (const file of files) {
    if (applied.has(file)) {
      log(`건너뜀: ${file}`);
      continue;
    }
    log(`적용 중: ${file}`);
    database.exec(readFileSync(path.join(dir, file), 'utf8'));
    database.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
  }
}
