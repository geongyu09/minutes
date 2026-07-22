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

/** SQLite FTS5 키워드 검색 — 해당 연결(사용자)의 청크만 대상으로 한다. */
export async function keywordSearch(
  connectionId: string,
  query: string,
  topK: number
): Promise<SearchResult[]> {
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
       JOIN documents d ON d.connection_id = c.connection_id AND d.id = c.document_id
       WHERE chunks_fts MATCH ? AND c.connection_id = ?
       ORDER BY bm25(chunks_fts)
       LIMIT ?`
    )
    .all(ftsQuery, connectionId, topK) as Parameters<typeof toSearchResult>[0][];
  return rows.map((row) => toSearchResult(row, 'keyword'));
}
