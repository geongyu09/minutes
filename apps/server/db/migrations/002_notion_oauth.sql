-- 노션 OAuth(Public Integration) 전환 — 사용자(연결)별 스코프 도입.
-- Internal Integration 단일 키로 색인된 기존 데이터는 소유자가 없어 무효이므로 비우고 재색인한다.
-- 같은 워크스페이스를 여러 사용자가 각자 연결하면 동일 노션 페이지 ID가 사용자별로 존재하므로
-- documents·chunks의 PK는 (connection_id, id) 복합키다.

CREATE TABLE notion_connections (
  id              TEXT PRIMARY KEY,
  app_token_hash  TEXT NOT NULL UNIQUE,  -- 앱 토큰은 해시(sha256)로만 저장 — 평문 저장 금지
  oauth_state     TEXT UNIQUE,           -- 인가 진행 중에만 값 존재, 완료 시 NULL
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | connected
  access_token    TEXT,                  -- 노션 OAuth 액세스 토큰 (연결 완료 후)
  refresh_token   TEXT,                  -- 노션이 발급하는 경우에만 저장
  bot_id          TEXT,
  workspace_id    TEXT,
  workspace_name  TEXT,
  workspace_icon  TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

DROP TABLE chunks;
DROP TABLE documents;
DROP TABLE chunks_vec;
DROP TABLE chunks_fts;

CREATE TABLE documents (
  connection_id     TEXT NOT NULL REFERENCES notion_connections(id) ON DELETE CASCADE,
  id                TEXT NOT NULL,       -- 노션 페이지 ID
  title             TEXT NOT NULL,
  url               TEXT NOT NULL,
  last_edited_time  TEXT NOT NULL,
  indexed_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (connection_id, id)
);

CREATE TABLE chunks (
  connection_id  TEXT NOT NULL,
  id             TEXT NOT NULL,          -- `${documentId}:${chunkIndex}`
  document_id    TEXT NOT NULL,
  chunk_index    INTEGER NOT NULL,
  content        TEXT NOT NULL,
  heading_path   TEXT NOT NULL DEFAULT '[]',  -- JSON 배열
  token_count    INTEGER NOT NULL,
  PRIMARY KEY (connection_id, id),
  FOREIGN KEY (connection_id, document_id)
    REFERENCES documents(connection_id, id) ON DELETE CASCADE
);

CREATE INDEX chunks_connection_document_idx ON chunks (connection_id, document_id);

-- 벡터 인덱스. rowid를 chunks.rowid와 공유한다.
-- 차원(768)은 config.embedding.dimension과 일치해야 한다.
CREATE VIRTUAL TABLE chunks_vec USING vec0(
  embedding float[768] distance_metric=cosine
);

-- 키워드 검색(FTS5, unicode61 — 공백 단위, 고유명사 매칭용). rowid를 chunks.rowid와 공유한다.
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content,
  tokenize = 'unicode61'
);
