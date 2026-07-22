import { runIndexing } from '../src/ingestion/indexer';
import { closeDb } from '../src/db';

async function main() {
  const result = await runIndexing('full');
  console.log(
    `전체 색인 완료 — 연결 ${result.connections}건, 대상 ${result.total}건, 성공 ${result.indexed}건, 실패 ${result.failed}건, 삭제 ${result.deleted}건`
  );
  closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
