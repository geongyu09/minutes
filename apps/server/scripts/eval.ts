/**
 * 평가 세트 실행 — Recall@k 측정.
 * 사용법: bun run eval [--topK 8] [--no-hybrid]
 * 목표: 평균 Recall@8 ≥ 0.8 (4단계 관문)
 */
import { retriever } from '../src/retrieval/retriever';
import { evalSet } from '../eval/dataset';
import { recallAtK } from '../eval/metrics';
import { closeDb } from '../src/db';

async function main() {
  const args = process.argv.slice(2);
  const topKIndex = args.indexOf('--topK');
  const topK = topKIndex >= 0 ? Number(args[topKIndex + 1]) : 8;
  const useHybrid = !args.includes('--no-hybrid');

  if (evalSet.length === 0) {
    console.error('평가 세트가 비어 있습니다. eval/dataset.ts에 질문-정답 쌍을 채워주세요.');
    process.exit(1);
  }

  let sum = 0;
  for (let i = 0; i < evalSet.length; i++) {
    const testCase = evalSet[i];
    const results = await retriever.retrieve(testCase.query, { topK, useHybrid });
    const recall = recallAtK(results, testCase.expectedDocumentIds, topK);
    sum += recall;

    const retrieved = results.map((r) => r.chunk.documentId);
    const missing = testCase.expectedDocumentIds.filter((id) => !retrieved.includes(id));
    const firstHitRank =
      retrieved.findIndex((id) => testCase.expectedDocumentIds.includes(id)) + 1;

    const detail =
      recall === 1
        ? `(rank ${firstHitRank})`
        : missing.length > 0
          ? `(${missing.join(', ')} 누락)`
          : '';
    console.log(
      `[${i + 1}/${evalSet.length}] ${testCase.query.padEnd(30)} Recall@${topK}: ${recall.toFixed(2)}  ${detail}`
    );
  }

  const average = sum / evalSet.length;
  console.log(`\n평균 Recall@${topK}: ${average.toFixed(2)}  (목표 ≥ 0.8)`);
  closeDb();
  if (average < 0.8) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
