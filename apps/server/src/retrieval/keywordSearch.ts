import { db } from '@/db';
import type { SearchResult } from '@minutes/core';
import { toSearchResult } from './vectorStore';

/** FTS5 구문 오류를 피하기 위해 각 토큰을 따옴표로 감싼다 (토큰 AND 매칭). */
function toFtsQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(' ');
}

/** SQLite FTS5 키워드 검색 (unicode61 — 공백 단위, 고유명사 매칭용). */
export async function keywordSearch(query: string, topK: number): Promise<SearchResult[]> {
  const ftsQuery = toFtsQuery(query);
  if (!ftsQuery) return [];

  // bm25()는 낮을수록 관련성이 높으므로 부호를 뒤집어 점수로 쓴다
  const rows = db()
    .prepare(
      `SELECT c.id, c.document_id, c.chunk_index, c.content, c.heading_path, c.token_count,
              d.title, d.url, d.last_edited_time,
              -bm25(chunks_fts) AS score
       FROM chunks_fts
       JOIN chunks c ON c.rowid = chunks_fts.rowid
       JOIN documents d ON d.id = c.document_id
       WHERE chunks_fts MATCH ?
       ORDER BY bm25(chunks_fts)
       LIMIT ?`
    )
    .all(ftsQuery, topK) as Parameters<typeof toSearchResult>[0][];
  return rows.map((row) => toSearchResult(row, 'keyword'));
}
