/** db/migrations/*.sql을 순서대로 실행한다. 실행 이력은 schema_migrations 테이블로 관리. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from '../src/core/db';

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const dir = path.join(process.cwd(), 'db', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set((await sql`SELECT name FROM schema_migrations`).map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`건너뜀: ${file}`);
      continue;
    }
    console.log(`적용 중: ${file}`);
    await sql.unsafe(readFileSync(path.join(dir, file), 'utf8'));
    await sql`INSERT INTO schema_migrations (name) VALUES (${file})`;
  }

  console.log('마이그레이션 완료');
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
