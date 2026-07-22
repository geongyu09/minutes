import { describe, expect, it } from 'vitest';
import type { Client } from '@notionhq/client';
import type { RawDocument } from '@minutes/core';
import { createNotionSource } from './index';

function mockClient(pages: unknown[], blocks: Record<string, unknown[] | Error>): Client {
  return {
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
  } as unknown as Client;
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

    const [doc] = await collect(createNotionSource(client).fetchAll());

    expect(doc.markdown).toBe('- 상태: 진행 중\n\n논의 내용');
  });

  it('본문 없는 행도 속성 텍스트로 색인 가능한 마크다운을 만든다', async () => {
    const client = mockClient(
      [dbRow('p1', '할 일', { 담당자: { type: 'people', people: [{ name: '박건규' }] } })],
      {}
    );

    const [doc] = await collect(createNotionSource(client).fetchAll());

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

    const [doc] = await collect(createNotionSource(client).fetchAll());

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

  it('중간 페이지가 404를 던져도 나머지 페이지는 정상 yield된다', async () => {
    const docs = await collect(createNotionSource(threePagesClient()).fetchAll());

    expect(docs.map((d) => d.id)).toEqual(['p1', 'p3']);
  });

  it('건너뛴 페이지를 onSkip 콜백으로 알린다', async () => {
    const skipped: { id: string; err: unknown }[] = [];
    const source = createNotionSource(threePagesClient());

    await collect(source.fetchAll({ onSkip: (page, err) => skipped.push({ id: page.id, err }) }));

    expect(skipped).toHaveLength(1);
    expect(skipped[0].id).toBe('p2');
    expect((skipped[0].err as { status?: number }).status).toBe(404);
  });

  it('fetchUpdatedSince도 날짜 필터 후 페이지 단위로 격리한다', async () => {
    const skipped: string[] = [];
    const source = createNotionSource(threePagesClient());

    const docs = await collect(
      source.fetchUpdatedSince(new Date(0), { onSkip: (page) => skipped.push(page.id) })
    );

    expect(docs.map((d) => d.id)).toEqual(['p1', 'p3']);
    expect(skipped).toEqual(['p2']);

    // 커서 이후 수정된 페이지가 없으면 아무것도 yield하지 않는다
    const none = await collect(source.fetchUpdatedSince(new Date('2026-07-02T00:00:00.000Z')));
    expect(none).toEqual([]);
  });
});
