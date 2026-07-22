import type { Client } from '@notionhq/client';
import { throttled } from './client';

export interface PageRef {
  id: string;
  title: string;
  url: string;
  lastEditedTime: string;
  parentTitle?: string;
  /** DB 행 속성 색인용 — search 응답의 properties 원본 */
  properties?: Record<string, unknown>;
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

function toPageRef(page: Record<string, any>): PageRef {
  return {
    id: page.id,
    title: extractTitle(page),
    url: page.url,
    lastEditedTime: page.last_edited_time,
    properties: page.properties,
  };
}

/** 페이지네이션을 처리하며 블록 자식을 전부 가져온다. child_page는 재귀에서 제외(별도 문서). */
export async function listAllBlocks(client: Client, blockId: string, depth = 0): Promise<BlockNode[]> {
  if (depth > 10) return [];

  const blocks: BlockNode[] = [];
  let cursor: string | undefined;

  do {
    const res: any = await throttled(() =>
      client.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 })
    );
    for (const block of res.results as any[]) {
      const node: BlockNode = { ...block, children: [] };
      if (block.has_children && block.type !== 'child_page') {
        node.children = await listAllBlocks(client, block.id, depth + 1);
      }
      blocks.push(node);
    }
    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);

  return blocks;
}

/**
 * 이 연결이 접근 가능한 모든 페이지 메타데이터를 수집한다.
 * OAuth 설치 시 사용자가 공유한 페이지(와 그 하위)가 search API로 전부 열거된다.
 */
export async function listAllPages(client: Client): Promise<PageRef[]> {
  const pages: PageRef[] = [];
  let cursor: string | undefined;

  do {
    const res: any = await throttled(() =>
      client.search({
        filter: { property: 'object', value: 'page' },
        start_cursor: cursor,
        page_size: 100,
      })
    );
    for (const page of res.results as any[]) {
      if (page.object === 'page') pages.push(toPageRef(page));
    }
    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);

  return pages;
}
