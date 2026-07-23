-- 16단계 색인 공유 — 계정·프로젝트·초대 (sharing.md, 2026-07-23 확정).
-- 앱 토큰의 귀속이 "연결"에서 "사용자"로 바뀐다. 프로젝트·연결에는 멤버십 검사로 도달한다.
-- 실사용 배포 전이므로 기존 연결·색인 데이터는 이관하지 않고 폐기한다
-- (이관 코드를 만드는 비용 > 재연결 한 번의 비용).

DELETE FROM chunks_fts;
DELETE FROM chunks_vec;
DELETE FROM chunks;
DELETE FROM documents;
DELETE FROM sync_state;
DROP TABLE notion_connections;

CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  notion_user_id  TEXT NOT NULL UNIQUE,  -- 노션 owner.user.id — 로그인 식별자
  email           TEXT,                  -- 노션이 주지 않을 수 있어 NULL 허용
  name            TEXT,
  avatar_url      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 앱 토큰은 sha256 해시로만 저장한다 — 평문 저장 금지.
CREATE TABLE app_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 로그인 인가의 노션 액세스 토큰은 사용자 식별에만 쓰고 저장하지 않는다.
-- 이 테이블은 "앱이 폴링으로 앱 토큰을 수령"하기 위한 일회성·단기 만료 세션이다.
CREATE TABLE login_sessions (
  id               TEXT PRIMARY KEY,
  poll_token_hash  TEXT NOT NULL UNIQUE,
  oauth_state      TEXT UNIQUE,
  app_token        TEXT,                 -- 인가 완료 후 앱이 일회 수령할 때까지만 보관
  expires_at       TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE memberships (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member',   -- owner | member
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE invites (
  code        TEXT PRIMARY KEY,          -- randomBytes URL-safe — 추측 불가
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by  TEXT NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX invites_project_idx ON invites (project_id);

-- 연결은 프로젝트당 1개(MVP). 색인 데이터(documents·chunks)는 connection_id로 격리된다.
-- 프로젝트 삭제 → 연결 삭제 → 색인 데이터 삭제가 CASCADE로 이어진다.
CREATE TABLE notion_connections (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  connected_by    TEXT REFERENCES users(id),   -- 색인용 노션 토큰의 소유자
  oauth_state     TEXT UNIQUE,                 -- 인가 진행 중에만 값 존재, 완료 시 NULL
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | connected
  access_token    TEXT,
  refresh_token   TEXT,
  bot_id          TEXT,
  workspace_id    TEXT,
  workspace_name  TEXT,
  workspace_icon  TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
