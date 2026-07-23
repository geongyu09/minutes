import type { DocumentListing, DocumentSource, RawDocument } from '@minutes/core';
import { logger } from '@minutes/core';
import { config } from '@/config';
import type { ThrottledClient } from './client';
import { listAllBlocks, listAllPages, type PageRef } from './fetcher';
import { propertiesToMarkdown, toMarkdown } from './transformer';

export interface FetchOptions {
  /** 오류로 건너뛴 페이지를 알린다 — 조용한 누락 금지 */
  onSkip?: (page: PageRef, err: unknown) => void;
}

export interface NotionSource extends DocumentSource<PageRef> {
  /** 변경 감지·삭제 감지용 목록 — 메타데이터만 조회. since를 주면 조기 종료할 수 있다. */
  listRefs(options?: { since?: Date }): Promise<DocumentListing<PageRef>>;
  /** 목록을 인자로 받아 수집한다 — 한 회차에 search를 두 번 호출하지 않는다. */
  fetch(refs: PageRef[], options?: FetchOptions): AsyncIterable<RawDocument>;
}

async function toRawDocument(api: ThrottledClient, page: PageRef): Promise<RawDocument> {
  const blocks = await listAllBlocks(api, page.id);
  // DB 행은 속성만 채워진 경우가 많다 — 속성을 앞에 붙여 본문 없는 행도 색인되게 한다
  const markdown = [propertiesToMarkdown(page.properties), toMarkdown(blocks)]
    .filter(Boolean)
    .join('\n\n');
  return {
    id: page.id,
    title: page.title,
    url: page.url,
    markdown,
    lastEditedTime: page.lastEditedTime,
    parentTitle: page.parentTitle,
  };
}

// 페이지 목록만 먼저 받고 최대 concurrency건을 동시에 변환하고 완료되는 대로 yield한다 — 느린 페이지가 뒤를 막지 않는다.
// 속도 상한은 client의 토큰 버킷이 잡으므로 여기서 더 조일 필요가 없다.
// 한 페이지의 오류(인가 제외로 인한 404 등)가 나머지 전체를 죽이지 않도록 페이지 단위로 격리한다.
async function* streamDocuments(
  api: ThrottledClient,
  pages: PageRef[],
  options?: FetchOptions
): AsyncIterable<RawDocument> {
  type Settled = { index: number; doc?: RawDocument; err?: unknown };
  const inFlight = new Map<number, Promise<Settled>>();
  let next = 0;
  let skipped = 0;

  const start = () => {
    const index = next++;
    const page = pages[index];
    inFlight.set(
      index,
      toRawDocument(api, page).then(
        (doc) => ({ index, doc }),
        (err) => ({ index, err })
      )
    );
  };

  // 동시에 메모리에 올라가는 문서를 concurrency건으로 묶는다 — 스트리밍의 메모리 이점을 되돌리지 않는다
  while (next < pages.length && inFlight.size < config.notion.concurrency) start();

  while (inFlight.size > 0) {
    const settled = await Promise.race(inFlight.values());
    inFlight.delete(settled.index);
    if (next < pages.length) start();

    if (settled.err !== undefined) {
      const page = pages[settled.index];
      skipped++;
      logger.error(`페이지 수집 실패, 건너뜀: ${page.title} (${page.id})`, String(settled.err));
      options?.onSkip?.(page, settled.err);
      continue;
    }
    yield settled.doc!;
  }

  if (skipped > 0) {
    logger.error(`수집 단계에서 ${skipped}건을 건너뛰었습니다 (전체 ${pages.length}건)`);
  }
}

/** 사용자(연결)의 액세스 토큰으로 만든 클라이언트에 스코프된 DocumentSource. */
export function createNotionSource(api: ThrottledClient): NotionSource {
  return {
    listRefs(options?: { since?: Date }) {
      return listAllPages(api, options);
    },

    fetch(refs: PageRef[], options?: FetchOptions): AsyncIterable<RawDocument> {
      return streamDocuments(api, refs, options);
    },
  };
}
