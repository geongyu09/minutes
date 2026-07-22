import { logger } from '@minutes/core';
import { vectorStore, deleteDocument, getAllDocumentIds } from '@/retrieval/vectorStore';
import { notionSource } from './notion';
import { chunkDocument } from './chunker';
import { embedChunks } from './embedder';
import { getLastSyncTime, setLastSyncTime } from './syncState';

export interface IndexingResult {
  mode: 'full' | 'incremental';
  total: number;
  indexed: number;
  failed: number;
  deleted: number;
}

export async function runIndexing(mode: 'full' | 'incremental'): Promise<IndexingResult> {
  // 색인 진행 중 수정된 문서가 다음 회차에서 누락되지 않도록 시작 시각으로 기록한다
  const startedAt = new Date();

  const documents =
    mode === 'full'
      ? await notionSource.fetchAll()
      : await notionSource.fetchUpdatedSince(await getLastSyncTime());

  let indexed = 0;
  let failed = 0;
  for (const doc of documents) {
    try {
      const chunks = chunkDocument(doc);
      if (chunks.length === 0) continue;

      const embedded = await embedChunks(chunks);
      await vectorStore.deleteByDocumentId(doc.id); // delete-then-insert
      await vectorStore.upsert(embedded);

      indexed++;
      logger.info(`[${indexed}/${documents.length}] ${doc.title} — 청크 ${chunks.length}개`);
    } catch (err) {
      failed++;
      logger.error(`색인 실패: ${doc.title}`, String(err));
      // 한 문서가 실패해도 나머지는 계속 진행
    }
  }

  // 삭제된 문서 정리 — 노션에 없는데 DB에 있는 문서를 지운다
  const currentIds = new Set((await notionSource.listPageRefs()).map((p) => p.id));
  const storedIds = await getAllDocumentIds();
  let deleted = 0;
  for (const id of storedIds) {
    if (!currentIds.has(id)) {
      await deleteDocument(id);
      deleted++;
    }
  }

  await setLastSyncTime(startedAt);
  return { mode, total: documents.length, indexed, failed, deleted };
}
