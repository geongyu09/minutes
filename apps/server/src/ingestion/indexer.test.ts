import { beforeAll, describe, expect, it } from 'vitest';
import type { RawDocument } from '@minutes/core';
import { db } from '@/db';
import { RateLimitError } from '@/embedder';
import { applyMigrations } from '@/migrations';
import {
  completeConnection,
  createPendingConnection,
  type NotionConnection,
} from '@/oauth/connections';
import { createVectorStore, getAllDocumentIds } from '@/retrieval/vectorStore';
import { getLastSyncTime } from './syncState';
import { runIndexingForConnection, type IndexerDeps } from './indexer';

function rawDoc(id: string, title: string, lastEditedTime = '2026-07-01T00:00:00.000Z'): RawDocument {
  return {
    id,
    title,
    url: `https://notion.so/${id}`,
    markdown: `# ${title}\n\n${title}에 대한 본문입니다.`,
    lastEditedTime,
  };
}

function fakeDeps(docs: RawDocument[]): IndexerDeps {
  return {
    source: {
      fetchAll: async function* () {
        yield* docs;
      },
      fetchUpdatedSince: async function* () {
        yield* docs;
      },
      listPageRefs: async () =>
        docs.map((d) => ({ id: d.id, title: d.title, url: d.url, lastEditedTime: d.lastEditedTime })),
    },
    embed: async (texts: string[]) => texts.map(() => new Array(768).fill(0.1)),
  };
}

function newConnection(): NotionConnection {
  const session = createPendingConnection();
  return completeConnection(session.state, { accessToken: `token-${session.connectionId}` })!
    .connection;
}

beforeAll(() => {
  applyMigrations(db());
});

describe('runIndexingForConnection', () => {
  it('해당 연결의 문서만 색인한다', async () => {
    const connA = newConnection();
    const connB = newConnection();

    const result = await runIndexingForConnection(connA, 'full', fakeDeps([rawDoc('doc-1', '주간 회의')]));

    expect(result.indexed).toBe(1);
    expect(await createVectorStore(connA.id).count()).toBeGreaterThan(0);
    expect(await createVectorStore(connB.id).count()).toBe(0);
  });

  it('노션에서 사라진 문서를 해당 연결에서만 지운다', async () => {
    const connA = newConnection();
    const connB = newConnection();

    await runIndexingForConnection(connA, 'full', fakeDeps([rawDoc('doc-1', '회의'), rawDoc('doc-2', '기획')]));
    await runIndexingForConnection(connB, 'full', fakeDeps([rawDoc('doc-2', '기획')]));

    // connA에서 doc-2가 사라짐
    const result = await runIndexingForConnection(connA, 'full', fakeDeps([rawDoc('doc-1', '회의')]));

    expect(result.deleted).toBe(1);
    expect(await getAllDocumentIds(connA.id)).toEqual(['doc-1']);
    expect(await getAllDocumentIds(connB.id)).toEqual(['doc-2']);
  });

  it('동기화 시각을 연결별로 기록한다', async () => {
    const connA = newConnection();
    const connB = newConnection();

    await runIndexingForConnection(connA, 'full', fakeDeps([rawDoc('doc-1', '회의')]));

    expect((await getLastSyncTime(connA.id)).getTime()).toBeGreaterThan(0);
    expect((await getLastSyncTime(connB.id)).getTime()).toBe(0);
  });

  it('한 문서 색인이 실패해도 나머지는 계속 진행한다', async () => {
    const conn = newConnection();
    const deps = fakeDeps([rawDoc('doc-ok', '정상 문서'), rawDoc('doc-bad', '실패 문서')]);
    const originalEmbed = deps.embed;
    deps.embed = async (texts) => {
      if (texts.some((t) => t.includes('실패 문서'))) throw new Error('임베딩 실패');
      return originalEmbed(texts);
    };

    const result = await runIndexingForConnection(conn, 'full', deps);

    expect(result.indexed).toBe(1);
    expect(result.failed).toBe(1);
  });
});

describe('커서 전진 규칙', () => {
  it('전 문서 성공 시 커서는 시작 시각으로 전진한다', async () => {
    const conn = newConnection();
    const before = Date.now();

    await runIndexingForConnection(conn, 'full', fakeDeps([rawDoc('doc-1', '회의')]));

    const cursor = (await getLastSyncTime(conn.id)).getTime();
    expect(cursor).toBeGreaterThanOrEqual(before);
    expect(cursor).toBeLessThanOrEqual(Date.now());
  });

  it('일부 문서 실패 시 커서는 실패 문서의 lastEditedTime보다 앞에 놓인다', async () => {
    const conn = newConnection();
    const failedEditedAt = '2026-07-10T00:00:00.000Z';
    const deps = fakeDeps([
      rawDoc('doc-ok', '정상 문서', '2026-07-15T00:00:00.000Z'),
      rawDoc('doc-bad', '실패 문서', failedEditedAt),
    ]);
    const originalEmbed = deps.embed;
    deps.embed = async (texts) => {
      if (texts.some((t) => t.includes('실패 문서'))) throw new Error('임베딩 실패');
      return originalEmbed(texts);
    };

    await runIndexingForConnection(conn, 'full', deps);

    // `>` 비교로 걸러지므로 커서가 실패 문서 시각보다 앞이어야 다음 회차에 다시 포함된다
    const cursor = await getLastSyncTime(conn.id);
    expect(cursor.getTime()).toBeLessThan(new Date(failedEditedAt).getTime());
    expect(new Date(failedEditedAt).getTime()).toBeGreaterThan(cursor.getTime());
  });

  it('RateLimitError는 색인을 중단하고 커서를 전진시키지 않는다', async () => {
    const conn = newConnection();
    const deps = fakeDeps([rawDoc('doc-1', '회의')]);
    deps.embed = async () => {
      throw new RateLimitError('쿼터 초과');
    };

    const result = await runIndexingForConnection(conn, 'full', deps);

    expect(result.aborted?.reason).toBe('rate_limit');
    expect((await getLastSyncTime(conn.id)).getTime()).toBe(0);
  });

  it('중단된 회차에서는 삭제 정리를 건너뛴다', async () => {
    const conn = newConnection();
    await runIndexingForConnection(conn, 'full', fakeDeps([rawDoc('doc-1', '회의'), rawDoc('doc-2', '기획')]));

    // 노션에서 doc-2가 사라진 상태에서 임베딩이 중단되면, 불완전한 목록으로 지우면 안 된다
    const deps = fakeDeps([rawDoc('doc-1', '회의')]);
    deps.embed = async () => {
      throw new RateLimitError('쿼터 초과');
    };
    const result = await runIndexingForConnection(conn, 'full', deps);

    expect(result.aborted?.reason).toBe('rate_limit');
    expect(result.deleted).toBe(0);
    expect(await getAllDocumentIds(conn.id)).toContain('doc-2');
  });

  it('401 오류는 unauthorized 사유로 중단하고 커서를 전진시키지 않는다', async () => {
    const conn = newConnection();
    const deps = fakeDeps([rawDoc('doc-1', '회의')]);
    deps.embed = async () => {
      throw Object.assign(new Error('토큰 만료'), { status: 401 });
    };

    const result = await runIndexingForConnection(conn, 'full', deps);

    expect(result.aborted?.reason).toBe('unauthorized');
    expect((await getLastSyncTime(conn.id)).getTime()).toBe(0);
  });
});
