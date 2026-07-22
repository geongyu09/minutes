import type { DocumentSource, RawDocument } from '@/core/types';
import { listAllBlocks, listAllPages, type PageRef } from './fetcher';
import { toMarkdown } from './transformer';

async function toRawDocument(page: PageRef): Promise<RawDocument> {
  const blocks = await listAllBlocks(page.id);
  return {
    id: page.id,
    title: page.title,
    url: page.url,
    markdown: toMarkdown(blocks),
    lastEditedTime: page.lastEditedTime,
    parentTitle: page.parentTitle,
  };
}

export const notionSource: DocumentSource & {
  listPageRefs(): Promise<PageRef[]>;
} = {
  async fetchAll(): Promise<RawDocument[]> {
    const pages = await listAllPages();
    const documents: RawDocument[] = [];
    for (const page of pages) {
      documents.push(await toRawDocument(page));
    }
    return documents;
  },

  async fetchUpdatedSince(date: Date): Promise<RawDocument[]> {
    const pages = await listAllPages();
    const changed = pages.filter((p) => new Date(p.lastEditedTime) > date);
    const documents: RawDocument[] = [];
    for (const page of changed) {
      documents.push(await toRawDocument(page));
    }
    return documents;
  },

  /** 증분 동기화의 삭제 감지용 — 메타데이터만 조회. */
  listPageRefs(): Promise<PageRef[]> {
    return listAllPages();
  },
};
