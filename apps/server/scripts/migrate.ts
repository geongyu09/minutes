/** db/migrations/*.sql을 순서대로 실행한다. 실행 이력은 schema_migrations 테이블로 관리. */
import { db, closeDb } from '../src/db';
import { applyMigrations } from '../src/migrations';

try {
  applyMigrations(db(), (msg) => console.log(msg));
  console.log('마이그레이션 완료');
  closeDb();
} catch (err) {
  console.error(err);
  process.exit(1);
}
