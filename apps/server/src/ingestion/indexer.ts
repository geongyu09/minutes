import { logger } from '@minutes/core';
import type { Chunk, EmbeddedChunk, RawDocument } from '@minutes/core';
import { config } from '@/config';
import { embedder, RateLimitError } from '@/embedder';
import {
  createVectorStore,
  deleteDocument,
  getAllDocumentIds,
  getContentHashes,
} from '@/retrieval/vectorStore';
import {
  listConnected,
  updateConnectionTokens,
  type NotionConnection,
} from '@/oauth/connections';
import { refreshTokens } from '@/oauth/notionOauth';
import { createNotionClient } from './notion/client';
import { createNotionSource, type NotionSource } from './notion';
import { chunkDocument } from './chunker';
import { contentHash } from './contentHash';
import {
  bumpRunsSinceSweep,
  getLastSweepTime,
  getLastSyncTime,
  getRunsSinceSweep,
  recordDeletionSweep,
  setLastSyncTime,
} from './syncState';

export interface IndexingResult {
  mode: 'full' | 'incremental';
  total: number;
  indexed: number;
  /** 내용이 그대로라 임베딩을 건너뛴 문서 수 — indexed와 구분해 보고한다 */
  skipped: number;
  failed: number;
  deleted: number;
  /** 이번 회차에 삭제 정리를 했는가 + 마지막으로 한 시각 — 삭제 반영 지연을 드러낸다 */
  deletionSweep: { performed: boolean; lastSweptAt?: string };
  /** 쿼터 초과·인증 만료 등으로 중단됨 — 커서를 전진시키지 않았다 */
  aborted?: { reason: 'rate_limit' | 'unauthorized'; message: string };
}

export interface IndexingSummary extends Omit<IndexingResult, 'deletionSweep'> {
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
  let skipped = 0;
  let failed = 0;
  const failedEditedTimes: number[] = [];
  let aborted: IndexingResult['aborted'];

  // 수집 단계에서 건너뛴 페이지도 "실패 문서"다 — 커서 계산에 똑같이 포함시킨다
  const onSkip = (page: { lastEditedTime: string }) => {
    failed++;
    failedEditedTimes.push(new Date(page.lastEditedTime).getTime());
  };

  const since = mode === 'incremental' ? await getLastSyncTime(connection.id) : undefined;
  // 전체 목록을 받는 회차에서만 삭제를 정리한다. 매 회차 전체 목록을 훑는 비용이 크므로
  // N회차마다 한 번만 받고, 그 사이의 삭제 반영 지연은 결과(deletionSweep)로 드러낸다.
  const runsSinceSweep = await getRunsSinceSweep(connection.id);
  const wantsFullList =
    !since || runsSinceSweep + 1 >= config.sync.fullListEveryNRuns;

  // 목록은 한 회차에 한 번만 조회한다 — 수집용과 삭제 감지용이 같은 search 결과다
  const listing = await deps.source.listRefs(wantsFullList ? undefined : { since });
  const targetRefs = since
    ? listing.refs.filter((p) => new Date(p.lastEditedTime) > since)
    : listing.refs;
  const total = targetRefs.length;
  onProgress?.({ indexed: 0, total });

  const documents = deps.source.fetch(targetRefs, { onSkip });

  // 임베딩 요청은 문서 경계를 넘어 batchSize까지 채운다 (요청 수 = 전체 청크 수 / batchSize).
  // 원자성 경계는 그대로 문서다 — DB 쓰기는 문서 단위 delete-then-insert를 유지한다.
  type Pending = { doc: RawDocument; chunks: Chunk[]; hash: string };
  const buffer: Pending[] = [];
  let bufferedChunks = 0;
  // 진행률은 "처리에 착수한 문서" 기준 — flush를 기다리는 동안 UI가 멈춰 보이지 않게 한다
  let processed = 0;

  // 문서 본문 해시는 문서당 한 번만 계산한다
  const hashes = new Map<string, string>();
  const hashOf = (doc: RawDocument) => {
    let hash = hashes.get(doc.id);
    if (!hash) hashes.set(doc.id, (hash = contentHash(doc.markdown)));
    return hash;
  };
  const knownHashes = await getContentHashes(connection.id);

  // 진행 중인 flush — 항상 1개 이하로 유지한다
  let pendingFlush: Promise<boolean> = Promise.resolve(true);

  const markFailed = (doc: RawDocument) => {
    failed++;
    failedEditedTimes.push(new Date(doc.lastEditedTime).getTime());
  };

  /** 버퍼를 통째로 꺼낸다 — flush가 도는 동안 수집이 새 버퍼를 채울 수 있게 동기적으로 비운다 */
  const takeBatch = () => {
    const batch = buffer.splice(0, buffer.length);
    bufferedChunks = 0;
    return batch;
  };

  /** 한 배치를 한 번의 embed 호출로 임베딩하고 문서 단위로 저장한다. 중단 오류면 false. */
  const flushBatch = async (batch: Pending[]): Promise<boolean> => {
    if (batch.length === 0) return true;
    const texts = batch.flatMap((b) => b.chunks.map((c) => c.content));

    let vectors: number[][];
    try {
      vectors = await deps.embed(texts);
      if (vectors.length !== texts.length) {
        throw new Error(`임베딩 개수가 요청과 다릅니다 (요청 ${texts.length}, 응답 ${vectors.length})`);
      }
    } catch (err) {
      // 중단 오류: 남은 문서도 같은 이유로 실패할 것이므로 즉시 멈추고 커서를 건드리지 않는다
      if (err instanceof RateLimitError) {
        aborted = { reason: 'rate_limit', message: String(err) };
      } else if (isUnauthorized(err)) {
        aborted = { reason: 'unauthorized', message: String(err) };
      }
      if (aborted) {
        logger.error(`색인 중단 (${aborted.reason}): 문서 ${batch.length}건`, aborted.message);
        return false;
      }
      // 실패는 이 배치까지만 번진다 — 다음 배치는 정상 진행한다
      for (const { doc } of batch) {
        markFailed(doc);
        logger.error(`색인 실패: ${doc.title}`, String(err));
      }
      return true;
    }

    let offset = 0;
    for (const { doc, chunks, hash } of batch) {
      const slice = vectors.slice(offset, offset + chunks.length);
      offset += chunks.length;
      try {
        const embedded: EmbeddedChunk[] = chunks.map((chunk, i) => ({ ...chunk, vector: slice[i] }));
        await vectorStore.deleteByDocumentId(doc.id); // delete-then-insert
        await vectorStore.upsert(embedded, { contentHash: hash });
        indexed++;
        logger.info(`[${indexed}/${total}] ${doc.title} — 청크 ${chunks.length}개`);
      } catch (err) {
        markFailed(doc);
        logger.error(`색인 실패: ${doc.title}`, String(err));
      }
    }
    return true;
  };

  for await (const doc of documents) {
    processed++;
    onProgress?.({ indexed: processed, total });

    // 내용·파라미터가 그대로면 벡터도 그대로다 — 청킹·임베딩·쓰기를 전부 건너뛴다
    if (knownHashes.get(doc.id) === hashOf(doc)) {
      skipped++;
      continue;
    }

    let chunks: Chunk[];
    try {
      chunks = chunkDocument(doc);
    } catch (err) {
      markFailed(doc);
      logger.error(`청킹 실패: ${doc.title}`, String(err));
      continue;
    }
    if (chunks.length === 0) continue;

    buffer.push({ doc, chunks, hash: hashOf(doc) });
    bufferedChunks += chunks.length;
    if (bufferedChunks >= config.embedding.batchSize) {
      // 배치를 먼저 떼어내고 이전 flush만 기다린다 — 수집은 flush가 도는 동안에도 계속된다.
      // 동시에 도는 flush는 1개로 제한한다 (임베딩 쿼터·SQLite 라이터 보호).
      const batch = takeBatch();
      if (!(await pendingFlush)) break;
      pendingFlush = flushBatch(batch);
    }
  }
  if (!(await pendingFlush)) {
    // 마지막 배치는 버린다 — 중단된 회차는 커서를 전진시키지 않으므로 다음 회차가 다시 시도한다
  } else if (!aborted) {
    await flushBatch(takeBatch());
  }

  if (aborted) {
    // 삭제 정리도 커서 전진도 하지 않는다 — 다음 회차가 이번 대상을 그대로 다시 시도한다
    await bumpRunsSinceSweep(connection.id);
    return {
      mode,
      total,
      indexed,
      skipped,
      failed,
      deleted: 0,
      deletionSweep: await sweepState(connection.id, false),
      aborted,
    };
  }

  // 삭제된 문서 정리 — 노션에 없는데 이 연결의 DB에 있는 문서를 지운다.
  // **불완전한 목록으로 지우면 멀쩡한 문서가 사라진다** — complete한 회차에서만 수행한다.
  let deleted = 0;
  if (listing.complete) {
    const currentIds = new Set(listing.refs.map((p) => p.id));
    for (const id of await getAllDocumentIds(connection.id)) {
      if (!currentIds.has(id)) {
        await deleteDocument(connection.id, id);
        deleted++;
      }
    }
    await recordDeletionSweep(connection.id, startedAt);
  } else {
    await bumpRunsSinceSweep(connection.id);
  }

  // 실패한 문서는 다음 회차 대상에 다시 포함되도록 커서를 그 문서 시각 앞으로 되돌린다
  // (fetchUpdatedSince가 `>` 비교이므로 1ms를 빼야 경계의 문서가 포함된다)
  const cursor =
    failedEditedTimes.length > 0
      ? new Date(Math.min(startedAt.getTime(), Math.min(...failedEditedTimes) - 1))
      : startedAt;
  await setLastSyncTime(connection.id, cursor);
  return {
    mode,
    total,
    indexed,
    skipped,
    failed,
    deleted,
    deletionSweep: await sweepState(connection.id, listing.complete),
  };
}

async function sweepState(
  connectionId: string,
  performed: boolean
): Promise<IndexingResult['deletionSweep']> {
  const lastSweptAt = await getLastSweepTime(connectionId);
  return { performed, lastSweptAt: lastSweptAt?.toISOString() };
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
    skipped: 0,
    failed: 0,
    deleted: 0,
  };

  for (const connection of connections) {
    try {
      const result = await indexConnectionWithRefresh(connection, mode);
      summary.total += result.total;
      summary.indexed += result.indexed;
      summary.skipped += result.skipped;
      summary.failed += result.failed;
      summary.deleted += result.deleted;
    } catch (err) {
      // 한 사용자 실패가 다른 사용자 색인을 멈추지 않게 한다
      logger.error(`색인 실패: 연결 ${connection.workspaceName ?? connection.id}`, String(err));
    }
  }

  return summary;
}
