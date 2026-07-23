import type { DocumentListing } from '@minutes/core';
import type { ThrottledClient } from './client';

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
export async function listAllBlocks(api: ThrottledClient, blockId: string, depth = 0): Promise<BlockNode[]> {
  if (depth > 10) return [];

  const blocks: BlockNode[] = [];
  let cursor: string | undefined;

  do {
    const res: any = await api.throttled(() =>
      api.client.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 })
    );
    for (const block of res.results as any[]) {
      const node: BlockNode = { ...block, children: [] };
      if (block.has_children && block.type !== 'child_page') {
        node.children = await listAllBlocks(api, block.id, depth + 1);
      }
      blocks.push(node);
    }
    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);

  return blocks;
}

/**
 * 이 연결이 접근 가능한 페이지 메타데이터를 수집한다.
 * OAuth 설치 시 사용자가 공유한 페이지(와 그 하위)가 search API로 전부 열거된다.
 *
 * `since`를 주면 최신순으로 받아 그보다 오래된 페이지가 나온 시점에 페이지네이션을 끊는다.
 * 그때 `complete`는 false다 — **불완전한 목록으로 삭제 정리를 돌리면 멀쩡한 문서가 사라진다.**
 */
export async function listAllPages(
  api: ThrottledClient,
  options?: { since?: Date }
): Promise<DocumentListing<PageRef>> {
  const since = options?.since;
  const refs: PageRef[] = [];
  let cursor: string | undefined;
  let complete = true;

  do {
    const res: any = await api.throttled(() =>
      api.client.search({
        filter: { property: 'object', value: 'page' },
        ...(since ? { sort: { timestamp: 'last_edited_time', direction: 'descending' } } : {}),
        start_cursor: cursor,
        page_size: 100,
      })
    );

    let reachedOlder = false;
    for (const page of res.results as any[]) {
      if (page.object !== 'page') continue;
      if (since && new Date(page.last_edited_time) <= since) {
        // 최신순이므로 이 뒤는 전부 커서보다 오래됐다 — 더 볼 필요가 없다
        reachedOlder = true;
        break;
      }
      refs.push(toPageRef(page));
    }

    if (reachedOlder) {
      // 커서보다 오래된 페이지를 목록에서 뺐으므로, 남은 페이지 유무와 무관하게 전체 목록이 아니다
      complete = false;
      cursor = undefined;
    } else {
      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    }
  } while (cursor);

  return { refs, complete };
}
