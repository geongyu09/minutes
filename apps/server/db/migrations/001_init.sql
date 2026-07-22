-- SQLite + sqlite-vec + FTS5 스키마.
-- 시각 값은 ISO 8601 문자열(TEXT)로 저장한다.

CREATE TABLE documents (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  url               TEXT NOT NULL,
  last_edited_time  TEXT NOT NULL,
  indexed_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE chunks (
  id             TEXT PRIMARY KEY,
  document_id    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index    INTEGER NOT NULL,
  content        TEXT NOT NULL,
  heading_path   TEXT NOT NULL DEFAULT '[]',  -- JSON 배열
  token_count    INTEGER NOT NULL
);

CREATE INDEX chunks_document_id_idx ON chunks (document_id);

-- 벡터 인덱스. rowid를 chunks.rowid와 공유한다.
-- 차원(768)은 config.embedding.dimension과 일치해야 한다.
CREATE VIRTUAL TABLE chunks_vec USING vec0(
  embedding float[768] distance_metric=cosine
);

-- 키워드 검색(FTS5, unicode61 — 공백 단위, 고유명사 매칭용).
-- rowid를 chunks.rowid와 공유한다.
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content,
  tokenize = 'unicode61'
);

CREATE TABLE sync_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
