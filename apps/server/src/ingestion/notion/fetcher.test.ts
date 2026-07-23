import { describe, expect, it } from 'vitest';
import type { Client } from '@notionhq/client';
import type { ThrottledClient } from './client';
import { listAllBlocks, listAllPages } from './fetcher';

/** 스로틀 없이 그대로 호출한다 — 속도 제한은 client.test.ts가 검증한다 */
const passthrough = (client: Client): ThrottledClient => ({ client, throttled: (fn) => fn() });

function page(id: string, title: string) {
  return {
    object: 'page',
    id,
    url: `https://notion.so/${id}`,
    last_edited_time: '2026-07-01T00:00:00.000Z',
    properties: { title: { type: 'title', title: [{ plain_text: title }] } },
  };
}

describe('listAllPages', () => {
  it('사용자 토큰의 search 결과에서 페이지 목록을 얻는다 (루트 env 미사용)', async () => {
    const client = {
      search: async () => ({
        results: [page('p1', '주간 회의'), page('p2', '기획 회의')],
        has_more: false,
        next_cursor: null,
      }),
    } as unknown as Client;

    const { refs: pages } = await listAllPages(passthrough(client));

    expect(pages.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(pages[0].title).toBe('주간 회의');
    expect(pages[0].url).toBe('https://notion.so/p1');
  });

  it('페이지네이션(has_more)을 끝까지 따라간다', async () => {
    const calls: (string | undefined)[] = [];
    const client = {
      search: async ({ start_cursor }: { start_cursor?: string }) => {
        calls.push(start_cursor);
        return start_cursor === 'cursor-2'
          ? { results: [page('p3', '3')], has_more: false, next_cursor: null }
          : { results: [page('p1', '1'), page('p2', '2')], has_more: true, next_cursor: 'cursor-2' };
      },
    } as unknown as Client;

    const { refs: pages } = await listAllPages(passthrough(client));

    expect(pages).toHaveLength(3);
    expect(calls).toEqual([undefined, 'cursor-2']);
  });

  it('since를 주면 최신순 정렬로 요청하고, 오래된 페이지가 나오면 페이지네이션을 끊는다', async () => {
    const calls: unknown[] = [];
    const old = { ...page('p-old', '오래된 회의'), last_edited_time: '2026-07-01T00:00:00.000Z' };
    const fresh = { ...page('p-new', '최근 회의'), last_edited_time: '2026-07-20T00:00:00.000Z' };
    const client = {
      search: async (args: Record<string, unknown>) => {
        calls.push(args);
        return { results: [fresh, old], has_more: true, next_cursor: 'cursor-2' };
      },
    } as unknown as Client;

    const listing = await listAllPages(passthrough(client), { since: new Date('2026-07-10T00:00:00.000Z') });

    expect(calls).toHaveLength(1); // 다음 커서를 요청하지 않는다
    expect((calls[0] as { sort: unknown }).sort).toEqual({
      timestamp: 'last_edited_time',
      direction: 'descending',
    });
    expect(listing.refs.map((p) => p.id)).toEqual(['p-new']);
    expect(listing.complete).toBe(false); // 일부만 받았다 — 삭제 감지에 쓰면 안 된다
  });

  it('since가 없으면 전체 목록이며 complete는 true다', async () => {
    const client = {
      search: async () => ({ results: [page('p1', '회의')], has_more: false, next_cursor: null }),
    } as unknown as Client;

    expect((await listAllPages(passthrough(client))).complete).toBe(true);
  });

  it('since를 줘도 끝까지 훑었으면 complete는 true다', async () => {
    const client = {
      search: async () => ({
        results: [{ ...page('p1', '회의'), last_edited_time: '2026-07-20T00:00:00.000Z' }],
        has_more: false,
        next_cursor: null,
      }),
    } as unknown as Client;

    const listing = await listAllPages(passthrough(client), { since: new Date('2026-07-10T00:00:00.000Z') });

    expect(listing.complete).toBe(true);
  });

  it('DB 행 속성 색인을 위해 properties를 그대로 전달한다', async () => {
    const row = {
      ...page('p1', '회의'),
      properties: {
        이름: { type: 'title', title: [{ plain_text: '회의' }] },
        상태: { type: 'status', status: { name: '진행 중' } },
      },
    };
    const client = {
      search: async () => ({ results: [row], has_more: false, next_cursor: null }),
    } as unknown as Client;

    const { refs: pages } = await listAllPages(passthrough(client));

    expect(pages[0].properties).toEqual(row.properties);
  });

  it('페이지가 아닌 결과는 무시한다', async () => {
    const client = {
      search: async () => ({
        results: [page('p1', '회의'), { object: 'database', id: 'db1' }],
        has_more: false,
        next_cursor: null,
      }),
    } as unknown as Client;

    expect((await listAllPages(passthrough(client))).refs).toHaveLength(1);
  });
});

describe('listAllBlocks', () => {
  it('has_children 블록은 재귀하되 child_page는 재귀에서 제외한다', async () => {
    const children: Record<string, unknown[]> = {
      root: [
        { id: 'b1', type: 'toggle', has_children: true },
        { id: 'b2', type: 'child_page', has_children: true },
      ],
      b1: [{ id: 'b1-1', type: 'paragraph', has_children: false }],
    };
    const client = {
      blocks: {
        children: {
          list: async ({ block_id }: { block_id: string }) => ({
            results: children[block_id] ?? [],
            has_more: false,
            next_cursor: null,
          }),
        },
      },
    } as unknown as Client;

    const blocks = await listAllBlocks(passthrough(client), 'root');

    expect(blocks).toHaveLength(2);
    expect(blocks[0].children.map((b) => b.id)).toEqual(['b1-1']);
    expect(blocks[1].children).toEqual([]); // child_page는 별도 문서로 다룬다
  });
});
