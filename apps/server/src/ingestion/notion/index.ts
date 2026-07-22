import type { Client } from '@notionhq/client';
import type { DocumentSource, RawDocument } from '@minutes/core';
import { logger } from '@minutes/core';
import { listAllBlocks, listAllPages, type PageRef } from './fetcher';
import { propertiesToMarkdown, toMarkdown } from './transformer';

export interface FetchOptions {
  /** 오류로 건너뛴 페이지를 알린다 — 조용한 누락 금지 */
  onSkip?: (page: PageRef, err: unknown) => void;
}

export interface NotionSource extends DocumentSource {
  fetchAll(options?: FetchOptions): AsyncIterable<RawDocument>;
  fetchUpdatedSince(date: Date, options?: FetchOptions): AsyncIterable<RawDocument>;
  /** 증분 동기화의 삭제 감지용 — 메타데이터만 조회. */
  listPageRefs(): Promise<PageRef[]>;
}

async function toRawDocument(client: Client, page: PageRef): Promise<RawDocument> {
  const blocks = await listAllBlocks(client, page.id);
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

// 페이지 목록만 먼저 받고 페이지별로 변환해 yield한다.
// 한 페이지의 오류(인가 제외로 인한 404 등)가 나머지 전체를 죽이지 않도록 페이지 단위로 격리한다.
async function* streamDocuments(
  client: Client,
  pages: PageRef[],
  options?: FetchOptions
): AsyncIterable<RawDocument> {
  let skipped = 0;
  for (const page of pages) {
    let doc: RawDocument;
    try {
      doc = await toRawDocument(client, page);
    } catch (err) {
      skipped++;
      logger.error(`페이지 수집 실패, 건너뜀: ${page.title} (${page.id})`, String(err));
      options?.onSkip?.(page, err);
      continue;
    }
    yield doc;
  }
  if (skipped > 0) {
    logger.error(`수집 단계에서 ${skipped}건을 건너뛰었습니다 (전체 ${pages.length}건)`);
  }
}

/** 사용자(연결)의 액세스 토큰으로 만든 클라이언트에 스코프된 DocumentSource. */
export function createNotionSource(client: Client): NotionSource {
  return {
    async *fetchAll(options?: FetchOptions): AsyncIterable<RawDocument> {
      const pages = await listAllPages(client);
      yield* streamDocuments(client, pages, options);
    },

    async *fetchUpdatedSince(date: Date, options?: FetchOptions): AsyncIterable<RawDocument> {
      const pages = (await listAllPages(client)).filter((p) => new Date(p.lastEditedTime) > date);
      yield* streamDocuments(client, pages, options);
    },

    listPageRefs(): Promise<PageRef[]> {
      return listAllPages(client);
    },
  };
}
