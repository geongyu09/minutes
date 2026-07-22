/**
 * 검색만 따로 테스트하는 CLI.
 * 사용법: bun run search "로그인 방식 뭐로 정했지?" [--topK 8] [--no-hybrid]
 */
import { createRetriever } from '../src/retrieval/retriever';
import { listConnected } from '../src/oauth/connections';
import { closeDb } from '../src/db';

async function main() {
  const args = process.argv.slice(2);
  const query = args.find((a) => !a.startsWith('--'));
  if (!query) {
    console.error('사용법: bun run search "질문" [--topK 8] [--no-hybrid]');
    process.exit(1);
  }

  const connections = listConnected();
  if (connections.length === 0) {
    console.error('연결된 노션 워크스페이스가 없습니다. 앱에서 노션을 먼저 연결하세요.');
    process.exit(1);
  }
  const retriever = createRetriever(connections[0].id);

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
