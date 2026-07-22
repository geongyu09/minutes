import { logger } from '@minutes/core';
import type { EmbeddedChunk } from '@minutes/core';
import { embedder, RateLimitError } from '@/embedder';
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
  /** 쿼터 초과·인증 만료 등으로 중단됨 — 커서를 전진시키지 않았다 */
  aborted?: { reason: 'rate_limit' | 'unauthorized'; message: string };
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
  deps: IndexerDeps = defaultDeps(connection),
  onProgress?: (progress: { indexed: number; total: number }) => void
): Promise<IndexingResult> {
  // 색인 진행 중 수정된 문서가 다음 회차에서 누락되지 않도록 시작 시각으로 기록한다
  const startedAt = new Date();
  const vectorStore = createVectorStore(connection.id);

  let indexed = 0;
  let failed = 0;
  const failedEditedTimes: number[] = [];
  let aborted: IndexingResult['aborted'];

  // 수집 단계에서 건너뛴 페이지도 "실패 문서"다 — 커서 계산에 똑같이 포함시킨다
  const onSkip = (page: { lastEditedTime: string }) => {
    failed++;
    failedEditedTimes.push(new Date(page.lastEditedTime).getTime());
  };

  const since = mode === 'incremental' ? await getLastSyncTime(connection.id) : undefined;
  // total은 선-수집한 페이지 목록 길이 — 진행 로그와 결과 보고에 쓴다
  const pageRefs = await deps.source.listPageRefs();
  const targetRefs = since ? pageRefs.filter((p) => new Date(p.lastEditedTime) > since) : pageRefs;
  const total = targetRefs.length;
  onProgress?.({ indexed: 0, total });

  const documents = since
    ? deps.source.fetchUpdatedSince(since, { onSkip })
    : deps.source.fetchAll({ onSkip });

  for await (const doc of documents) {
    try {
      const chunks = chunkDocument(doc);
      if (chunks.length === 0) continue;

      const vectors = await deps.embed(chunks.map((c) => c.content));
      const embedded: EmbeddedChunk[] = chunks.map((chunk, i) => ({ ...chunk, vector: vectors[i] }));
      await vectorStore.deleteByDocumentId(doc.id); // delete-then-insert
      await vectorStore.upsert(embedded);

      indexed++;
      onProgress?.({ indexed, total });
      logger.info(`[${indexed}/${total}] ${doc.title} — 청크 ${chunks.length}개`);
    } catch (err) {
      // 중단 오류: 남은 문서도 같은 이유로 실패할 것이므로 즉시 멈추고 커서를 건드리지 않는다
      if (err instanceof RateLimitError) {
        aborted = { reason: 'rate_limit', message: String(err) };
      } else if (isUnauthorized(err)) {
        aborted = { reason: 'unauthorized', message: String(err) };
      }
      if (aborted) {
        logger.error(`색인 중단 (${aborted.reason}): ${doc.title}`, aborted.message);
        break;
      }
      failed++;
      failedEditedTimes.push(new Date(doc.lastEditedTime).getTime());
      logger.error(`색인 실패: ${doc.title}`, String(err));
      // 한 문서가 실패해도 나머지는 계속 진행
    }
  }

  if (aborted) {
    // 삭제 정리도 커서 전진도 하지 않는다 — 다음 회차가 이번 대상을 그대로 다시 시도한다
    return { mode, total, indexed, failed, deleted: 0, aborted };
  }

  // 삭제된 문서 정리 — 노션에 없는데 이 연결의 DB에 있는 문서를 지운다
  const currentIds = new Set(pageRefs.map((p) => p.id));
  const storedIds = await getAllDocumentIds(connection.id);
  let deleted = 0;
  for (const id of storedIds) {
    if (!currentIds.has(id)) {
      await deleteDocument(connection.id, id);
      deleted++;
    }
  }

  // 실패한 문서는 다음 회차 대상에 다시 포함되도록 커서를 그 문서 시각 앞으로 되돌린다
  // (fetchUpdatedSince가 `>` 비교이므로 1ms를 빼야 경계의 문서가 포함된다)
  const cursor =
    failedEditedTimes.length > 0
      ? new Date(Math.min(startedAt.getTime(), Math.min(...failedEditedTimes) - 1))
      : startedAt;
  await setLastSyncTime(connection.id, cursor);
  return { mode, total, indexed, failed, deleted };
}

function isUnauthorized(err: unknown): boolean {
  return (err as { status?: number })?.status === 401;
}

/**
 * 액세스 토큰이 만료(401)되면 refresh_token으로 한 번 갱신 후 재시도한다.
 * API의 백그라운드 잡과 스케줄러가 공유하는 진입점.
 */
export async function indexConnectionWithRefresh(
  connection: NotionConnection,
  mode: 'full' | 'incremental',
  onProgress?: (progress: { indexed: number; total: number }) => void
): Promise<IndexingResult> {
  try {
    return await runIndexingForConnection(connection, mode, undefined, onProgress);
  } catch (err) {
    if (!isUnauthorized(err) || !connection.refreshToken) throw err;
    const renewed = await refreshTokens(connection.refreshToken);
    updateConnectionTokens(connection.id, renewed);
    return runIndexingForConnection(
      { ...connection, accessToken: renewed.accessToken },
      mode,
      undefined,
      onProgress
    );
  }
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
      const result = await indexConnectionWithRefresh(connection, mode);
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
