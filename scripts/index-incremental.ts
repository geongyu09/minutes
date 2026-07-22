import { runIndexing } from '../src/ingestion/indexer';
import { sql } from '../src/core/db';

async function main() {
  const result = await runIndexing('incremental');
  console.log(
    `증분 색인 완료 — 대상 ${result.total}건, 성공 ${result.indexed}건, 실패 ${result.failed}건, 삭제 ${result.deleted}건`
  );
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
