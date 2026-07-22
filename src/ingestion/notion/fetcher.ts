import { config } from '@/core/config';
import { notion, throttled } from './client';

export interface PageRef {
  id: string;
  title: string;
  url: string;
  lastEditedTime: string;
  parentTitle?: string;
}

export interface BlockNode {
  id: string;
  type: string;
  has_children?: boolean;
  children: BlockNode[];
  [key: string]: unknown;
}

function extractTitle(page: Record<string, any>): string {
  const properties = page.properties ?? {};
  for (const prop of Object.values<any>(properties)) {
    if (prop?.type === 'title') {
      return prop.title.map((t: any) => t.plain_text).join('') || '(제목 없음)';
    }
  }
  return '(제목 없음)';
}

function toPageRef(page: Record<string, any>, parentTitle?: string): PageRef {
  return {
    id: page.id,
    title: extractTitle(page),
    url: page.url,
    lastEditedTime: page.last_edited_time,
    parentTitle,
  };
}

/** 페이지네이션을 처리하며 블록 자식을 전부 가져온다. child_page는 재귀에서 제외(별도 문서). */
export async function listAllBlocks(blockId: string, depth = 0): Promise<BlockNode[]> {
  if (depth > 10) return [];

  const blocks: BlockNode[] = [];
  let cursor: string | undefined;

  do {
    const res: any = await throttled(() =>
      notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 })
    );
    for (const block of res.results as any[]) {
      const node: BlockNode = { ...block, children: [] };
      if (block.has_children && block.type !== 'child_page') {
        node.children = await listAllBlocks(block.id, depth + 1);
      }
      blocks.push(node);
    }
    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);

  return blocks;
}

async function queryDatabase(databaseId: string): Promise<{ id: string }[]> {
  const rows: { id: string }[] = [];
  let cursor: string | undefined;

  do {
    const res: any = await throttled(() =>
      notion.databases.query({ database_id: databaseId, start_cursor: cursor, page_size: 100 })
    );
    rows.push(...res.results.map((r: any) => ({ id: r.id })));
    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);

  return rows;
}

/** 루트 페이지 아래를 BFS로 순회해 모든 페이지 메타데이터를 수집한다. */
export async function listAllPages(): Promise<PageRef[]> {
  const pages: PageRef[] = [];
  const queue: { id: string; parentTitle?: string }[] = config.notion.rootPageIds.map((id) => ({ id }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const { id: pageId, parentTitle } = queue.shift()!;
    if (visited.has(pageId)) continue;
    visited.add(pageId);

    const page: any = await throttled(() => notion.pages.retrieve({ page_id: pageId }));
    const ref = toPageRef(page, parentTitle);
    pages.push(ref);

    const children = await listAllBlocks(pageId);
    for (const block of flatten(children)) {
      if (block.type === 'child_page') queue.push({ id: block.id, parentTitle: ref.title });
      if (block.type === 'child_database') {
        const rows = await queryDatabase(block.id);
        queue.push(...rows.map((r) => ({ id: r.id, parentTitle: ref.title })));
      }
    }
  }
  return pages;
}

function flatten(blocks: BlockNode[]): BlockNode[] {
  return blocks.flatMap((b) => [b, ...flatten(b.children)]);
}
