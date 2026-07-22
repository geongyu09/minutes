/** db/migrations/*.sql을 순서대로 실행한다. 실행 이력은 schema_migrations 테이블로 관리. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { db, closeDb } from '../src/db';

function main() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  const dir = path.join(process.cwd(), 'db', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (db().prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map(
      (r) => r.name
    )
  );

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`건너뜀: ${file}`);
      continue;
    }
    console.log(`적용 중: ${file}`);
    db().exec(readFileSync(path.join(dir, file), 'utf8'));
    db().prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
  }

  console.log('마이그레이션 완료');
  closeDb();
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
