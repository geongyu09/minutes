import { beforeAll, describe, expect, it } from 'vitest';
import type { EmbeddedChunk } from '@minutes/core';
import { db } from '@/db';
import { applyMigrations } from '@/migrations';
import { completeConnection, createPendingConnection } from '@/oauth/connections';
import {
  countDocuments,
  createVectorStore,
  deleteDocument,
  getAllDocumentIds,
} from './vectorStore';
import { keywordSearch } from './keywordSearch';

const DIMENSION = 768;

function vec(seed: number): number[] {
  // 코사인 거리용 단순 단위 벡터 — seed 위치만 1
  const v = new Array(DIMENSION).fill(0);
  v[seed % DIMENSION] = 1;
  return v;
}

function chunk(documentId: string, index: number, content: string, seed: number): EmbeddedChunk {
  return {
    id: `${documentId}:${index}`,
    documentId,
    chunkIndex: index,
    content,
    metadata: {
      documentTitle: `${documentId} 제목`,
      documentUrl: `https://notion.so/${documentId}`,
      headingPath: ['회의', '결정사항'],
      lastEditedTime: '2026-07-01T00:00:00.000Z',
      tokenCount: 10,
    },
    vector: vec(seed),
  };
}

function newConnection(): string {
  const session = createPendingConnection();
  completeConnection(session.state, { accessToken: `token-${session.connectionId}` });
  return session.connectionId;
}

let userA: string;
let userB: string;

beforeAll(async () => {
  applyMigrations(db());
  userA = newConnection();
  userB = newConnection();

  // 두 사용자가 같은 워크스페이스를 연결한 상황 — 동일 문서 ID(doc-1)가 양쪽에 존재
  await createVectorStore(userA).upsert([
    chunk('doc-1', 0, 'A 사용자의 로그인 결정', 1),
    chunk('doc-1', 1, 'A 사용자의 배포 일정', 2),
  ]);
  // upsert는 문서 단위로 호출한다 (indexer의 delete-then-upsert 규칙)
  await createVectorStore(userB).upsert([chunk('doc-1', 0, 'B 사용자의 로그인 결정', 1)]);
  await createVectorStore(userB).upsert([chunk('doc-2', 0, 'B 사용자의 휴가 정책', 3)]);
});

describe('createVectorStore(연결별 스코프)', () => {
  it('벡터 검색은 해당 사용자의 청크만 반환한다', async () => {
    const results = await createVectorStore(userA).search(vec(1), 10);

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.chunk.content).toContain('A 사용자');
    }
  });

  it('다른 사용자의 문서는 아무리 유사해도 섞이지 않는다', async () => {
    const results = await createVectorStore(userB).search(vec(1), 10);

    const contents = results.map((r) => r.chunk.content);
    expect(contents.some((c) => c.includes('B 사용자'))).toBe(true);
    expect(contents.some((c) => c.includes('A 사용자'))).toBe(false);
  });

  it('count는 해당 사용자의 청크 수만 센다', async () => {
    expect(await createVectorStore(userA).count()).toBe(2);
    expect(await createVectorStore(userB).count()).toBe(2);
  });

  it('deleteByDocumentId는 같은 문서 ID여도 해당 사용자 것만 지운다', async () => {
    const userC = newConnection();
    const userD = newConnection();
    await createVectorStore(userC).upsert([chunk('shared-doc', 0, 'C의 청크', 5)]);
    await createVectorStore(userD).upsert([chunk('shared-doc', 0, 'D의 청크', 5)]);

    await createVectorStore(userC).deleteByDocumentId('shared-doc');

    expect(await createVectorStore(userC).count()).toBe(0);
    expect(await createVectorStore(userD).count()).toBe(1);
  });
});

describe('keywordSearch(연결별 스코프)', () => {
  it('키워드 검색도 해당 사용자의 청크만 반환한다', async () => {
    const results = await keywordSearch(userA, '로그인', 10);

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.chunk.content).toContain('A 사용자');
    }
  });
});

describe('문서 관리 헬퍼(연결별 스코프)', () => {
  it('countDocuments·getAllDocumentIds는 해당 사용자 문서만 다룬다', async () => {
    expect(await countDocuments(userA)).toBe(1);
    expect(await getAllDocumentIds(userB)).toEqual(expect.arrayContaining(['doc-1', 'doc-2']));
    expect(await getAllDocumentIds(userA)).toEqual(['doc-1']);
  });

  it('deleteDocument는 해당 사용자의 문서·청크만 지운다', async () => {
    const userE = newConnection();
    const userF = newConnection();
    await createVectorStore(userE).upsert([chunk('doc-x', 0, 'E의 청크', 7)]);
    await createVectorStore(userF).upsert([chunk('doc-x', 0, 'F의 청크', 7)]);

    await deleteDocument(userE, 'doc-x');

    expect(await countDocuments(userE)).toBe(0);
    expect(await countDocuments(userF)).toBe(1);
  });
});
