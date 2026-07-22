import type { Client } from '@notionhq/client';
import type { DocumentSource, RawDocument } from '@minutes/core';
import { listAllBlocks, listAllPages, type PageRef } from './fetcher';
import { toMarkdown } from './transformer';

export interface NotionSource extends DocumentSource {
  /** 증분 동기화의 삭제 감지용 — 메타데이터만 조회. */
  listPageRefs(): Promise<PageRef[]>;
}

async function toRawDocument(client: Client, page: PageRef): Promise<RawDocument> {
  const blocks = await listAllBlocks(client, page.id);
  return {
    id: page.id,
    title: page.title,
    url: page.url,
    markdown: toMarkdown(blocks),
    lastEditedTime: page.lastEditedTime,
    parentTitle: page.parentTitle,
  };
}

/** 사용자(연결)의 액세스 토큰으로 만든 클라이언트에 스코프된 DocumentSource. */
export function createNotionSource(client: Client): NotionSource {
  return {
    async fetchAll(): Promise<RawDocument[]> {
      const pages = await listAllPages(client);
      const documents: RawDocument[] = [];
      for (const page of pages) {
        documents.push(await toRawDocument(client, page));
      }
      return documents;
    },

    async fetchUpdatedSince(date: Date): Promise<RawDocument[]> {
      const pages = (await listAllPages(client)).filter((p) => new Date(p.lastEditedTime) > date);
      const documents: RawDocument[] = [];
      for (const page of pages) {
        documents.push(await toRawDocument(client, page));
      }
      return documents;
    },

    listPageRefs(): Promise<PageRef[]> {
      return listAllPages(client);
    },
  };
}
