import { beforeAll, describe, expect, it } from 'vitest';
import type { RawDocument } from '@minutes/core';
import { db } from '@/db';
import { applyMigrations } from '@/migrations';
import {
  completeConnection,
  createPendingConnection,
  type NotionConnection,
} from '@/oauth/connections';
import { createVectorStore, getAllDocumentIds } from '@/retrieval/vectorStore';
import { getLastSyncTime } from './syncState';
import { runIndexingForConnection, type IndexerDeps } from './indexer';

function rawDoc(id: string, title: string): RawDocument {
  return {
    id,
    title,
    url: `https://notion.so/${id}`,
    markdown: `# ${title}\n\n${title}에 대한 본문입니다.`,
    lastEditedTime: '2026-07-01T00:00:00.000Z',
  };
}

function fakeDeps(docs: RawDocument[]): IndexerDeps {
  return {
    source: {
      fetchAll: async () => docs,
      fetchUpdatedSince: async () => docs,
      listPageRefs: async () =>
        docs.map((d) => ({ id: d.id, title: d.title, url: d.url, lastEditedTime: d.lastEditedTime })),
    },
    embed: async (texts: string[]) => texts.map(() => new Array(768).fill(0.1)),
  };
}

function newConnection(): NotionConnection {
  const session = createPendingConnection();
  return completeConnection(session.state, { accessToken: `token-${session.connectionId}` })!;
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
