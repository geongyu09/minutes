import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RawDocument } from '@minutes/core';
import { config } from '@/config';
import { db } from '@/db';
import { RateLimitError } from '@/embedder';
import { chunkDocument } from './chunker';
import { applyMigrations } from '@/migrations';
import { upsertUser } from '@/auth/users';
import { createProject } from '@/projects/projects';
import { completeConnection, startConnection, type NotionConnection } from '@/oauth/connections';
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

const toRef = (d: RawDocument) => ({
  id: d.id,
  title: d.title,
  url: d.url,
  lastEditedTime: d.lastEditedTime,
});

function fakeDeps(docs: RawDocument[], listing?: { complete?: boolean }): IndexerDeps {
  const byId = new Map(docs.map((d) => [d.id, d]));
  return {
    source: {
      listRefs: async () => ({ refs: docs.map(toRef), complete: listing?.complete ?? true }),
      fetch: async function* (refs) {
        for (const ref of refs) yield byId.get(ref.id)!;
      },
    },
    embed: async (texts: string[]) => texts.map(() => new Array(768).fill(0.1)),
  };
}

/** 청크가 정확히 chunkCount개 나오는 문서 — 배치 경계 테스트용 */
function docWithChunks(id: string, chunkCount: number, lastEditedTime?: string): RawDocument {
  const markdown = Array.from(
    { length: chunkCount },
    (_, i) => `## 섹션 ${i}\n\n${`${id} 섹션 ${i}의 논의 내용입니다. `.repeat(10)}`
  ).join('\n\n');
  const doc = { ...rawDoc(id, id, lastEditedTime), markdown };
  // 청킹 파라미터가 바뀌면 이 전제가 깨진다 — 테스트가 침묵하지 않도록 여기서 고정한다
  if (chunkDocument(doc).length !== chunkCount) {
    throw new Error(`테스트 전제 위반: ${id}의 청크가 ${chunkDocument(doc).length}개`);
  }
  return doc;
}

let userSeq = 0;

function newConnection(): NotionConnection {
  const user = upsertUser({ notionUserId: `notion-user-${++userSeq}`, name: '테스터' });
  const project = createProject(`프로젝트 ${userSeq}`, user.id);
  const session = startConnection(project.id, user.id);
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

  it('한 배치의 임베딩이 실패해도 나머지 배치는 계속 진행한다', async () => {
    const conn = newConnection();
    const { batchSize } = config.embedding;
    // 배치가 정확히 나뉘도록 문서 하나가 batchSize를 채우게 한다
    const deps = fakeDeps([docWithChunks('doc-bad', batchSize), docWithChunks('doc-ok', batchSize)]);
    const originalEmbed = deps.embed;
    deps.embed = async (texts) => {
      if (texts.some((t) => t.includes('doc-bad'))) throw new Error('임베딩 실패');
      return originalEmbed(texts);
    };

    const result = await runIndexingForConnection(conn, 'full', deps);

    expect(result.indexed).toBe(1);
    expect(result.failed).toBe(1);
    expect(await getAllDocumentIds(conn.id)).toEqual(['doc-ok']);
  });
});

describe('임베딩 배치 (문서 경계를 넘어 채운다)', () => {
  it('작은 문서 여러 건을 한 번의 embed 호출로 묶는다', async () => {
    const conn = newConnection();
    const docs = Array.from({ length: 10 }, (_, i) => docWithChunks(`doc-${i}`, 3));
    const deps = fakeDeps(docs);
    const embed = vi.fn(deps.embed);
    deps.embed = embed;

    const result = await runIndexingForConnection(conn, 'full', deps);

    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0][0]).toHaveLength(30);
    expect(result.indexed).toBe(10);
  });

  it('버퍼가 batchSize에 도달하면 flush하고, 남은 문서는 마지막에 flush한다', async () => {
    const conn = newConnection();
    const size = config.embedding.batchSize;
    const docs = [0, 1, 2].map((i) => docWithChunks(`doc-${i}`, Math.ceil(size * 0.6)));
    const deps = fakeDeps(docs);
    const embed = vi.fn(deps.embed);
    deps.embed = embed;

    const result = await runIndexingForConnection(conn, 'full', deps);

    expect(embed).toHaveBeenCalledTimes(2);
    expect(result.indexed).toBe(3);
    expect((await getAllDocumentIds(conn.id)).sort()).toEqual(['doc-0', 'doc-1', 'doc-2']);
  });

  it('flush가 도는 동안에도 수집을 계속한다', async () => {
    const conn = newConnection();
    const docs = [0, 1, 2].map((i) => docWithChunks(`doc-${i}`, config.embedding.batchSize));
    const deps = fakeDeps(docs);
    let pulled = 0;
    deps.source.fetch = async function* () {
      for (const doc of docs) {
        pulled++;
        yield doc;
      }
    };
    const originalEmbed = deps.embed;
    let pulledWhenFirstEmbedEnded = 0;
    let call = 0;
    deps.embed = async (texts) => {
      const mine = ++call;
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (mine === 1) pulledWhenFirstEmbedEnded = pulled;
      return originalEmbed(texts);
    };

    const result = await runIndexingForConnection(conn, 'full', deps);

    expect(result.indexed).toBe(3);
    // 직렬이면 첫 임베딩이 끝난 시점에 1건만 수집돼 있다
    expect(pulledWhenFirstEmbedEnded).toBeGreaterThan(1);
  });

  it('문서와 벡터의 대응이 어긋나지 않는다', async () => {
    const conn = newConnection();
    const docs = [0, 1, 2].map((i) => docWithChunks(`doc-${i}`, 3));
    const deps = fakeDeps(docs);
    // 텍스트마다 서로 다른 축의 단위벡터를 준다 — 뒤섞이면 검색으로 드러난다
    const vectorOf = new Map<string, number[]>();
    deps.embed = async (texts) => {
      return texts.map((text) => {
        const vector = new Array(config.embedding.dimension).fill(0);
        vector[vectorOf.size % config.embedding.dimension] = 1;
        vectorOf.set(text, vector);
        return vector;
      });
    };

    await runIndexingForConnection(conn, 'full', deps);

    // 저장된 벡터를 청크 본문과 직접 대조한다 — 배치 응답을 되돌려 매핑하는 부분의 검증
    const rows = db()
      .prepare(
        `SELECT c.content, v.embedding FROM chunks c
         JOIN chunks_vec v ON v.rowid = c.rowid
         WHERE c.connection_id = ?`
      )
      .all(conn.id) as { content: string; embedding: Buffer }[];

    expect(rows).toHaveLength(vectorOf.size);
    for (const row of rows) {
      const expected = Buffer.from(new Float32Array(vectorOf.get(row.content)!).buffer);
      expect(Buffer.from(row.embedding).equals(expected)).toBe(true);
    }
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
    // (본문을 바꿔 해시 스킵을 피한다 — 스킵되면 임베딩 자체가 일어나지 않는다)
    const edited = { ...rawDoc('doc-1', '회의'), markdown: '# 회의\n\n본문이 바뀌었습니다.' };
    const deps = fakeDeps([edited]);
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

describe('삭제 정리 분리 (조기 종료한 회차는 지우지 않는다)', () => {
  it('한 회차에 목록을 한 번만 조회한다', async () => {
    const conn = newConnection();
    const deps = fakeDeps([rawDoc('doc-1', '회의')]);
    const listRefs = vi.fn(deps.source.listRefs);
    deps.source.listRefs = listRefs;

    await runIndexingForConnection(conn, 'full', deps);

    expect(listRefs).toHaveBeenCalledTimes(1);
  });

  it('전체 색인은 목록을 since 없이 조회한다 (전체 목록)', async () => {
    const conn = newConnection();
    const deps = fakeDeps([rawDoc('doc-1', '회의')]);
    const listRefs = vi.fn(deps.source.listRefs);
    deps.source.listRefs = listRefs;

    await runIndexingForConnection(conn, 'full', deps);

    expect(listRefs.mock.calls[0][0]).toBeUndefined();
  });

  it('목록이 불완전한(조기 종료) 회차는 삭제 정리를 하지 않는다', async () => {
    const conn = newConnection();
    await runIndexingForConnection(conn, 'full', fakeDeps([rawDoc('doc-1', '회의'), rawDoc('doc-2', '기획')]));

    // 증분 회차에서 doc-2가 목록에 없지만, 조기 종료한 목록이므로 지우면 안 된다
    const result = await runIndexingForConnection(
      conn,
      'incremental',
      fakeDeps([rawDoc('doc-1', '회의')], { complete: false })
    );

    expect(result.deleted).toBe(0);
    expect(result.deletionSweep.performed).toBe(false);
    expect(await getAllDocumentIds(conn.id)).toContain('doc-2');
  });

  it('N회차마다 전체 목록을 받아 삭제를 반영한다', async () => {
    const conn = newConnection();
    await runIndexingForConnection(conn, 'full', fakeDeps([rawDoc('doc-1', '회의'), rawDoc('doc-2', '기획')]));

    const partial = () => fakeDeps([rawDoc('doc-1', '회의')], { complete: false });
    const listCalls: (unknown | undefined)[] = [];
    for (let run = 1; run < config.sync.fullListEveryNRuns; run++) {
      const deps = partial();
      const listRefs = vi.fn(deps.source.listRefs);
      deps.source.listRefs = listRefs;
      const result = await runIndexingForConnection(conn, 'incremental', deps);
      listCalls.push(listRefs.mock.calls[0][0]);
      expect(result.deleted).toBe(0);
    }

    // 마지막 회차는 전체 목록(since 없이)을 요청하고 삭제를 반영한다
    const deps = fakeDeps([rawDoc('doc-1', '회의')]);
    const listRefs = vi.fn(deps.source.listRefs);
    deps.source.listRefs = listRefs;
    const swept = await runIndexingForConnection(conn, 'incremental', deps);

    expect(listCalls.every((args) => args !== undefined)).toBe(true); // 그 전 회차들은 since로 조기 종료
    expect(listRefs.mock.calls[0][0]).toBeUndefined();
    expect(swept.deleted).toBe(1);
    expect(swept.deletionSweep.performed).toBe(true);
    expect(swept.deletionSweep.lastSweptAt).toBeDefined();
    expect(await getAllDocumentIds(conn.id)).toEqual(['doc-1']);
  });
});

describe('내용이 그대로인 문서는 임베딩을 건너뛴다', () => {
  it('두 번째 전체 색인은 임베딩을 호출하지 않고 skipped로 센다', async () => {
    const conn = newConnection();
    const docs = [rawDoc('doc-1', '회의'), rawDoc('doc-2', '기획')];
    await runIndexingForConnection(conn, 'full', fakeDeps(docs));

    const deps = fakeDeps(docs);
    const embed = vi.fn(deps.embed);
    deps.embed = embed;
    const result = await runIndexingForConnection(conn, 'full', deps);

    expect(embed).not.toHaveBeenCalled();
    expect(result.skipped).toBe(2);
    expect(result.indexed).toBe(0);
    // 건너뛴 문서의 청크는 그대로 남아 있다
    expect((await getAllDocumentIds(conn.id)).sort()).toEqual(['doc-1', 'doc-2']);
  });

  it('본문이 바뀐 문서만 다시 임베딩한다', async () => {
    const conn = newConnection();
    await runIndexingForConnection(
      conn,
      'full',
      fakeDeps([rawDoc('doc-1', '회의'), rawDoc('doc-2', '기획')])
    );

    const changed = { ...rawDoc('doc-2', '기획'), markdown: '# 기획\n\n내용이 바뀌었습니다.' };
    const deps = fakeDeps([rawDoc('doc-1', '회의'), changed]);
    const embed = vi.fn(deps.embed);
    deps.embed = embed;
    const result = await runIndexingForConnection(conn, 'full', deps);

    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0][0].every((t) => t.includes('기획'))).toBe(true);
    expect(result.indexed).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('임베딩 차원이 바뀌면 본문이 같아도 다시 임베딩한다', async () => {
    const conn = newConnection();
    const docs = [rawDoc('doc-1', '회의')];
    await runIndexingForConnection(conn, 'full', fakeDeps(docs));

    const original = config.embedding.dimension;
    (config.embedding as { dimension: number }).dimension = 1536;
    try {
      const deps = fakeDeps(docs);
      const embed = vi.fn(deps.embed);
      deps.embed = embed;
      const result = await runIndexingForConnection(conn, 'full', deps);

      expect(embed).toHaveBeenCalledTimes(1);
      expect(result.skipped).toBe(0);
    } finally {
      (config.embedding as { dimension: number }).dimension = original;
    }
  });
});
