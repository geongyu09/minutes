import { sql } from '@/core/db';
import type { SearchResult } from '@/core/types';
import { toSearchResult } from './vectorStore';

/** Postgres full-text 검색 (simple 사전 — 공백 단위, 고유명사 매칭용). */
export async function keywordSearch(query: string, topK: number): Promise<SearchResult[]> {
  const rows = await sql`
    SELECT c.id, c.document_id, c.chunk_index, c.content, c.heading_path, c.token_count,
           d.title, d.url, d.last_edited_time,
           ts_rank(c.content_tsv, plainto_tsquery('simple', ${query})) AS score
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.content_tsv @@ plainto_tsquery('simple', ${query})
    ORDER BY score DESC
    LIMIT ${topK}
  `;
  return rows.map((row) => toSearchResult(row, 'keyword'));
}
