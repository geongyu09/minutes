import { describe, expect, it } from 'vitest';
import type { Client } from '@notionhq/client';
import type { RawDocument } from '@minutes/core';
import type { ThrottledClient } from './client';
import { createNotionSource, type FetchOptions, type NotionSource } from './index';

/** 스로틀 없이 그대로 호출한다 — 속도 제한은 client.test.ts가 검증한다 */
const passthrough = (client: Client): ThrottledClient => ({ client, throttled: (fn) => fn() });

function mockClient(pages: unknown[], blocks: Record<string, unknown[] | Error>): ThrottledClient {
  return passthrough({
    search: async () => ({ results: pages, has_more: false, next_cursor: null }),
    blocks: {
      children: {
        list: async ({ block_id }: { block_id: string }) => {
          const result = blocks[block_id];
          if (result instanceof Error) throw result;
          return { results: result ?? [], has_more: false, next_cursor: null };
        },
      },
    },
  } as unknown as Client);
}

/** 목록 조회 → 수집까지 한 번에 — 소스는 목록을 인자로 받는다 */
async function collectAll(source: NotionSource, options?: FetchOptions): Promise<RawDocument[]> {
  const { refs } = await source.listRefs();
  return collect(source.fetch(refs, options));
}

async function collect(iterable: AsyncIterable<RawDocument>): Promise<RawDocument[]> {
  const docs: RawDocument[] = [];
  for await (const doc of iterable) docs.push(doc);
  return docs;
}

function dbRow(id: string, title: string, extraProps: Record<string, unknown> = {}) {
  return {
    object: 'page',
    id,
    url: `https://notion.so/${id}`,
    last_edited_time: '2026-07-01T00:00:00.000Z',
    properties: {
      이름: { type: 'title', title: [{ plain_text: title }] },
      ...extraProps,
    },
  };
}

describe('createNotionSource — DB 행 속성 색인', () => {
  it('속성을 본문 마크다운 앞에 붙인다', async () => {
    const client = mockClient(
      [dbRow('p1', '주간 회의', { 상태: { type: 'status', status: { name: '진행 중' } } })],
      {
        p1: [
          {
            id: 'b1',
            type: 'paragraph',
            has_children: false,
            paragraph: { rich_text: [{ plain_text: '논의 내용' }] },
          },
        ],
      }
    );

    const [doc] = await collectAll(createNotionSource(client));

    expect(doc.markdown).toBe('- 상태: 진행 중\n\n논의 내용');
  });

  it('본문 없는 행도 속성 텍스트로 색인 가능한 마크다운을 만든다', async () => {
    const client = mockClient(
      [dbRow('p1', '할 일', { 담당자: { type: 'people', people: [{ name: '박건규' }] } })],
      {}
    );

    const [doc] = await collectAll(createNotionSource(client));

    expect(doc.markdown).toBe('- 담당자: 박건규');
  });

  it('속성이 제목뿐인 일반 페이지는 본문만 남는다', async () => {
    const client = mockClient([dbRow('p1', '일반 페이지')], {
      p1: [
        {
          id: 'b1',
          type: 'paragraph',
          has_children: false,
          paragraph: { rich_text: [{ plain_text: '본문' }] },
        },
      ],
    });

    const [doc] = await collectAll(createNotionSource(client));

    expect(doc.markdown).toBe('본문');
  });
});

describe('createNotionSource — 페이지 단위 격리', () => {
  function threePagesClient() {
    const paragraph = (text: string) => [
      { id: 'b1', type: 'paragraph', has_children: false, paragraph: { rich_text: [{ plain_text: text }] } },
    ];
    return mockClient([dbRow('p1', '첫째'), dbRow('p2', '둘째'), dbRow('p3', '셋째')], {
      p1: paragraph('첫째 본문'),
      p2: Object.assign(new Error('Could not find block'), { status: 404 }),
      p3: paragraph('셋째 본문'),
    });
  }

  it('느린 페이지가 뒤 페이지의 yield를 막지 않는다', async () => {
    const paragraph = (text: string) => [
      { id: 'b1', type: 'paragraph', has_children: false, paragraph: { rich_text: [{ plain_text: text }] } },
    ];
    const pages = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const client = passthrough({
      search: async () => ({
        results: pages.map((id) => dbRow(id, id)),
        has_more: false,
        next_cursor: null,
      }),
      blocks: {
        children: {
          list: async ({ block_id }: { block_id: string }) => {
            if (block_id === 'p2') await new Promise((resolve) => setTimeout(resolve, 50));
            return { results: paragraph(`${block_id} 본문`), has_more: false, next_cursor: null };
          },
        },
      },
    } as unknown as Client);

    const docs = await collectAll(createNotionSource(client));

    expect(docs).toHaveLength(5);
    expect(docs[docs.length - 1].id).toBe('p2');
  });

  it('중간 페이지가 404를 던져도 나머지 페이지는 정상 yield된다', async () => {
    const docs = await collectAll(createNotionSource(threePagesClient()));

    expect(docs.map((d) => d.id)).toEqual(['p1', 'p3']);
  });

  it('건너뛴 페이지를 onSkip 콜백으로 알린다', async () => {
    const skipped: { id: string; err: unknown }[] = [];
    const source = createNotionSource(threePagesClient());

    await collectAll(source, { onSkip: (page, err) => skipped.push({ id: page.id, err }) });

    expect(skipped).toHaveLength(1);
    expect(skipped[0].id).toBe('p2');
    expect((skipped[0].err as { status?: number }).status).toBe(404);
  });

  it('since 이후 페이지만 목록에 담고, 수집은 페이지 단위로 격리한다', async () => {
    const skipped: string[] = [];
    const source = createNotionSource(threePagesClient());

    const { refs } = await source.listRefs({ since: new Date(0) });
    const docs = await collect(source.fetch(refs, { onSkip: (page) => skipped.push(page.id) }));

    expect(docs.map((d) => d.id)).toEqual(['p1', 'p3']);
    expect(skipped).toEqual(['p2']);

    // 커서 이후 수정된 페이지가 없으면 목록이 비고, 조기 종료했으므로 complete는 false다
    const later = await source.listRefs({ since: new Date('2026-07-02T00:00:00.000Z') });
    expect(later.refs).toEqual([]);
    expect(later.complete).toBe(false);
  });
});
