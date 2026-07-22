/**
 * 검색만 따로 테스트하는 CLI.
 * 사용법: bun run search "로그인 방식 뭐로 정했지?" [--topK 8] [--no-hybrid]
 */
import { retriever } from '../src/retrieval/retriever';
import { closeDb } from '../src/db';

async function main() {
  const args = process.argv.slice(2);
  const query = args.find((a) => !a.startsWith('--'));
  if (!query) {
    console.error('사용법: bun run search "질문" [--topK 8] [--no-hybrid]');
    process.exit(1);
  }

  const topKIndex = args.indexOf('--topK');
  const topK = topKIndex >= 0 ? Number(args[topKIndex + 1]) : undefined;
  const useHybrid = !args.includes('--no-hybrid');

  const t0 = Date.now();
  const results = await retriever.retrieve(query, { topK, useHybrid });
  const elapsed = Date.now() - t0;

  console.log(`질의: ${query}  (${elapsed}ms, hybrid=${useHybrid})\n`);
  results.forEach((r, i) => {
    const meta = r.chunk.metadata;
    const path = meta.headingPath.length > 0 ? ` > ${meta.headingPath.join(' > ')}` : '';
    console.log(`[${i + 1}] score=${r.score.toFixed(4)}  ${meta.documentTitle}${path}`);
    console.log(`    ${r.chunk.content.replace(/\n/g, ' ').slice(0, 120)}\n`);
  });

  closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
