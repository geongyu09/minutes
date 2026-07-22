import { db } from '@/db';
import type { EmbeddedChunk, SearchResult, VectorStore } from '@minutes/core';

interface ChunkRow {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  heading_path: string;
  token_count: number;
  title: string;
  url: string;
  last_edited_time: string;
  score: number;
}

export function toSearchResult(row: ChunkRow, source: SearchResult['source']): SearchResult {
  return {
    chunk: {
      id: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      metadata: {
        documentTitle: row.title,
        documentUrl: row.url,
        headingPath: JSON.parse(row.heading_path ?? '[]'),
        lastEditedTime: new Date(row.last_edited_time).toISOString(),
        tokenCount: row.token_count,
      },
    },
    score: Number(row.score),
    source,
  };
}

function toVecBlob(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

/** 문서에 속한 청크의 rowid를 조회해 vec·fts 인덱스에서 함께 지운다. */
function deleteChunksOfDocument(documentId: string): void {
  const rowids = (
    db().prepare('SELECT rowid FROM chunks WHERE document_id = ?').all(documentId) as {
      rowid: number;
    }[]
  ).map((r) => r.rowid);

  const deleteVec = db().prepare('DELETE FROM chunks_vec WHERE rowid = ?');
  const deleteFts = db().prepare('DELETE FROM chunks_fts WHERE rowid = ?');
  for (const rowid of rowids) {
    deleteVec.run(BigInt(rowid));
    deleteFts.run(rowid);
  }
  db().prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId);
}

export const vectorStore: VectorStore = {
  async upsert(chunks: EmbeddedChunk[]) {
    if (chunks.length === 0) return;

    const doc = chunks[0].metadata;
    const upsertAll = db().transaction(() => {
      db()
        .prepare(
          `INSERT INTO documents (id, title, url, last_edited_time)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             title = excluded.title,
             url = excluded.url,
             last_edited_time = excluded.last_edited_time,
             indexed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
        )
        .run(chunks[0].documentId, doc.documentTitle, doc.documentUrl, doc.lastEditedTime);

      const insertChunk = db().prepare(
        `INSERT INTO chunks (id, document_id, chunk_index, content, heading_path, token_count)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           content = excluded.content,
           heading_path = excluded.heading_path,
           token_count = excluded.token_count`
      );
      const selectRowid = db().prepare('SELECT rowid FROM chunks WHERE id = ?');
      const deleteVec = db().prepare('DELETE FROM chunks_vec WHERE rowid = ?');
      const deleteFts = db().prepare('DELETE FROM chunks_fts WHERE rowid = ?');
      const insertVec = db().prepare('INSERT INTO chunks_vec (rowid, embedding) VALUES (?, ?)');
      const insertFts = db().prepare('INSERT INTO chunks_fts (rowid, content) VALUES (?, ?)');

      for (const chunk of chunks) {
        insertChunk.run(
          chunk.id,
          chunk.documentId,
          chunk.chunkIndex,
          chunk.content,
          JSON.stringify(chunk.metadata.headingPath),
          chunk.metadata.tokenCount
        );
        const { rowid } = selectRowid.get(chunk.id) as { rowid: number };
        deleteVec.run(BigInt(rowid));
        deleteFts.run(rowid);
        insertVec.run(BigInt(rowid), toVecBlob(chunk.vector));
        insertFts.run(rowid, chunk.content);
      }
    });
    upsertAll();
  },

  async search(vector, topK) {
    // vec0의 distance는 코사인 거리이므로 1 - 거리가 유사도
    const rows = db()
      .prepare(
        `SELECT c.id, c.document_id, c.chunk_index, c.content, c.heading_path, c.token_count,
                d.title, d.url, d.last_edited_time,
                1 - v.distance AS score
         FROM (
           SELECT rowid, distance FROM chunks_vec
           WHERE embedding MATCH ? AND k = ?
         ) v
         JOIN chunks c ON c.rowid = v.rowid
         JOIN documents d ON d.id = c.document_id
         ORDER BY v.distance`
      )
      .all(toVecBlob(vector), topK) as ChunkRow[];
    return rows.map((row) => toSearchResult(row, 'vector'));
  },

  async deleteByDocumentId(documentId: string) {
    db().transaction(() => deleteChunksOfDocument(documentId))();
  },

  async count() {
    const { count } = db().prepare('SELECT count(*) AS count FROM chunks').get() as {
      count: number;
    };
    return count;
  },
};

export async function countDocuments(): Promise<number> {
  const { count } = db().prepare('SELECT count(*) AS count FROM documents').get() as {
    count: number;
  };
  return count;
}

export async function getAllDocumentIds(): Promise<string[]> {
  const rows = db().prepare('SELECT id FROM documents').all() as { id: string }[];
  return rows.map((r) => r.id);
}

export async function deleteDocument(documentId: string): Promise<void> {
  db().transaction(() => {
    deleteChunksOfDocument(documentId);
    db().prepare('DELETE FROM documents WHERE id = ?').run(documentId);
  })();
}
