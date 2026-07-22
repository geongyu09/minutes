import { logger } from '@minutes/core';
import type { EmbeddedChunk } from '@minutes/core';
import { embedder } from '@/embedder';
import { createVectorStore, deleteDocument, getAllDocumentIds } from '@/retrieval/vectorStore';
import {
  listConnected,
  updateConnectionTokens,
  type NotionConnection,
} from '@/oauth/connections';
import { refreshTokens } from '@/oauth/notionOauth';
import { createNotionClient } from './notion/client';
import { createNotionSource, type NotionSource } from './notion';
import { chunkDocument } from './chunker';
import { getLastSyncTime, setLastSyncTime } from './syncState';

export interface IndexingResult {
  mode: 'full' | 'incremental';
  total: number;
  indexed: number;
  failed: number;
  deleted: number;
}

export interface IndexingSummary extends IndexingResult {
  connections: number;
}

/** 테스트에서 노션·임베딩을 대체할 수 있도록 의존성을 주입한다. */
export interface IndexerDeps {
  source: NotionSource;
  embed: (texts: string[]) => Promise<number[][]>;
}

function defaultDeps(connection: NotionConnection): IndexerDeps {
  if (!connection.accessToken) {
    throw new Error(`연결(${connection.id})에 액세스 토큰이 없습니다`);
  }
  return {
    source: createNotionSource(createNotionClient(connection.accessToken)),
    embed: (texts) => embedder.embed(texts),
  };
}

/** 한 연결(사용자)의 워크스페이스를 색인한다. */
export async function runIndexingForConnection(
  connection: NotionConnection,
  mode: 'full' | 'incremental',
  deps: IndexerDeps = defaultDeps(connection)
): Promise<IndexingResult> {
  // 색인 진행 중 수정된 문서가 다음 회차에서 누락되지 않도록 시작 시각으로 기록한다
  const startedAt = new Date();
  const vectorStore = createVectorStore(connection.id);

  const documents =
    mode === 'full'
      ? await deps.source.fetchAll()
      : await deps.source.fetchUpdatedSince(await getLastSyncTime(connection.id));

  let indexed = 0;
  let failed = 0;
  for (const doc of documents) {
    try {
      const chunks = chunkDocument(doc);
      if (chunks.length === 0) continue;

      const vectors = await deps.embed(chunks.map((c) => c.content));
      const embedded: EmbeddedChunk[] = chunks.map((chunk, i) => ({ ...chunk, vector: vectors[i] }));
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

  // 삭제된 문서 정리 — 노션에 없는데 이 연결의 DB에 있는 문서를 지운다
  const currentIds = new Set((await deps.source.listPageRefs()).map((p) => p.id));
  const storedIds = await getAllDocumentIds(connection.id);
  let deleted = 0;
  for (const id of storedIds) {
    if (!currentIds.has(id)) {
      await deleteDocument(connection.id, id);
      deleted++;
    }
  }

  await setLastSyncTime(connection.id, startedAt);
  return { mode, total: documents.length, indexed, failed, deleted };
}

function isUnauthorized(err: unknown): boolean {
  return (err as { status?: number })?.status === 401;
}

/**
 * 연결이 완료된 모든 사용자를 순서대로 색인한다.
 * 액세스 토큰이 만료(401)되면 refresh_token으로 한 번 갱신 후 재시도한다.
 */
export async function runIndexing(mode: 'full' | 'incremental'): Promise<IndexingSummary> {
  const connections = listConnected();
  if (connections.length === 0) {
    logger.info('연결된 노션 워크스페이스가 없습니다. 앱에서 노션을 연결하세요.');
  }

  const summary: IndexingSummary = {
    mode,
    connections: connections.length,
    total: 0,
    indexed: 0,
    failed: 0,
    deleted: 0,
  };

  for (const connection of connections) {
    try {
      let result: IndexingResult;
      try {
        result = await runIndexingForConnection(connection, mode);
      } catch (err) {
        if (!isUnauthorized(err) || !connection.refreshToken) throw err;
        const renewed = await refreshTokens(connection.refreshToken);
        updateConnectionTokens(connection.id, renewed);
        result = await runIndexingForConnection({ ...connection, accessToken: renewed.accessToken }, mode);
      }
      summary.total += result.total;
      summary.indexed += result.indexed;
      summary.failed += result.failed;
      summary.deleted += result.deleted;
    } catch (err) {
      // 한 사용자 실패가 다른 사용자 색인을 멈추지 않게 한다
      logger.error(`색인 실패: 연결 ${connection.workspaceName ?? connection.id}`, String(err));
    }
  }

  return summary;
}
