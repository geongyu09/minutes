CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  url               TEXT NOT NULL,
  last_edited_time  TIMESTAMPTZ NOT NULL,
  indexed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chunks (
  id             TEXT PRIMARY KEY,
  document_id    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index    INT NOT NULL,
  content        TEXT NOT NULL,
  heading_path   TEXT[] NOT NULL DEFAULT '{}',
  token_count    INT NOT NULL,
  embedding      vector(1536) NOT NULL,
  content_tsv    tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED
);

CREATE INDEX chunks_document_id_idx ON chunks (document_id);
CREATE INDEX chunks_embedding_idx ON chunks
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX chunks_tsv_idx ON chunks USING gin (content_tsv);

CREATE TABLE sync_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
