import { sql } from '@/core/db';
import type { EmbeddedChunk, SearchResult, VectorStore } from '@/core/types';

export function toSearchResult(row: any, source: SearchResult['source']): SearchResult {
  return {
    chunk: {
      id: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      metadata: {
        documentTitle: row.title,
        documentUrl: row.url,
        headingPath: row.heading_path ?? [],
        lastEditedTime: new Date(row.last_edited_time).toISOString(),
        tokenCount: row.token_count,
      },
    },
    score: Number(row.score),
    source,
  };
}

export const vectorStore: VectorStore = {
  async upsert(chunks: EmbeddedChunk[]) {
    if (chunks.length === 0) return;

    const doc = chunks[0].metadata;
    await sql`
      INSERT INTO documents (id, title, url, last_edited_time)
      VALUES (${chunks[0].documentId}, ${doc.documentTitle}, ${doc.documentUrl}, ${doc.lastEditedTime})
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        url = EXCLUDED.url,
        last_edited_time = EXCLUDED.last_edited_time,
        indexed_at = now()
    `;

    for (const chunk of chunks) {
      await sql`
        INSERT INTO chunks (id, document_id, chunk_index, content, heading_path, token_count, embedding)
        VALUES (
          ${chunk.id}, ${chunk.documentId}, ${chunk.chunkIndex}, ${chunk.content},
          ${chunk.metadata.headingPath}, ${chunk.metadata.tokenCount},
          ${JSON.stringify(chunk.vector)}::vector
        )
        ON CONFLICT (id) DO UPDATE SET
          content = EXCLUDED.content,
          heading_path = EXCLUDED.heading_path,
          token_count = EXCLUDED.token_count,
          embedding = EXCLUDED.embedding
      `;
    }
  },

  async search(vector, topK) {
    // <=>는 코사인 거리이므로 1 - 거리가 유사도
    const rows = await sql`
      SELECT c.id, c.document_id, c.chunk_index, c.content, c.heading_path, c.token_count,
             d.title, d.url, d.last_edited_time,
             1 - (c.embedding <=> ${JSON.stringify(vector)}::vector) AS score
      FROM chunks c
      JOIN documents d ON d.id = c.document_id
      ORDER BY c.embedding <=> ${JSON.stringify(vector)}::vector
      LIMIT ${topK}
    `;
    return rows.map((row) => toSearchResult(row, 'vector'));
  },

  async deleteByDocumentId(documentId: string) {
    await sql`DELETE FROM chunks WHERE document_id = ${documentId}`;
  },

  async count() {
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM chunks`;
    return count;
  },
};

export async function countDocuments(): Promise<number> {
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM documents`;
  return count;
}

export async function getAllDocumentIds(): Promise<string[]> {
  const rows = await sql`SELECT id FROM documents`;
  return rows.map((r) => r.id);
}

export async function deleteDocument(documentId: string): Promise<void> {
  await sql`DELETE FROM documents WHERE id = ${documentId}`;
}
