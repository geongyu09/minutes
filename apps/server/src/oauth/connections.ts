import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db } from '@/db';

export interface NotionConnection {
  id: string;
  status: 'pending' | 'connected';
  /** 인가 URL을 발급하고 아직 콜백이 돌아오지 않은 상태 — 최초 연결 중이거나 연결 변경 중이다. */
  reconnecting: boolean;
  accessToken?: string;
  refreshToken?: string;
  workspaceId?: string;
  workspaceName?: string;
}

export interface CompletedConnection {
  connection: NotionConnection;
  /** 직전과 다른 워크스페이스가 연결됐다 — 호출자는 기존 색인 데이터를 폐기해야 한다. */
  workspaceChanged: boolean;
}

export interface ConnectionSession {
  connectionId: string;
  appToken: string;
  state: string;
}

export interface WorkspaceGrant {
  accessToken: string;
  refreshToken?: string;
  botId?: string;
  workspaceId?: string;
  workspaceName?: string;
  workspaceIcon?: string;
}

interface ConnectionRow {
  id: string;
  status: 'pending' | 'connected';
  oauth_state: string | null;
  access_token: string | null;
  refresh_token: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
}

const CONNECTION_COLUMNS =
  'id, status, oauth_state, access_token, refresh_token, workspace_id, workspace_name';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toConnection(row: ConnectionRow): NotionConnection {
  return {
    id: row.id,
    status: row.status,
    reconnecting: row.oauth_state !== null,
    accessToken: row.access_token ?? undefined,
    refreshToken: row.refresh_token ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    workspaceName: row.workspace_name ?? undefined,
  };
}

// 인가 화면에서 돌아오지 않은 pending 연결의 수명 — 지나면 정리한다 (무제한 누적 방지)
const PENDING_TTL = '-1 hour';

/** OAuth 시작 — 앱 토큰과 state를 발급하고 pending 연결을 만든다. 앱 토큰은 해시로만 저장. */
export function createPendingConnection(): ConnectionSession {
  db()
    .prepare(
      `DELETE FROM notion_connections
       WHERE status = 'pending' AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`
    )
    .run(PENDING_TTL);

  const connectionId = randomUUID();
  const appToken = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');

  db()
    .prepare(
      'INSERT INTO notion_connections (id, app_token_hash, oauth_state) VALUES (?, ?, ?)'
    )
    .run(connectionId, hashToken(appToken), state);

  return { connectionId, appToken, state };
}

/**
 * 콜백에서 노션 토큰 교환 전에 state가 살아 있는 세션인지 먼저 거른다 (외부 호출 증폭 방지).
 * 연결 변경 중인 연결은 이미 connected이므로 status로 거르지 않는다 — state 존재 여부가 기준이다.
 */
export function hasOauthState(state: string): boolean {
  const row = db().prepare('SELECT 1 FROM notion_connections WHERE oauth_state = ?').get(state);
  return row !== undefined;
}

/**
 * 연결 변경 — 기존 연결에 새 state만 발급한다.
 * 앱 토큰·connectionId·기존 노션 토큰은 그대로 두므로, 사용자가 인가를 중도 포기해도 잃는 것이 없다.
 */
export function startReconnect(connectionId: string): string | null {
  const state = randomBytes(32).toString('base64url');
  const result = db()
    .prepare(
      `UPDATE notion_connections
       SET oauth_state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    )
    .run(state, connectionId);
  return result.changes > 0 ? state : null;
}

/**
 * 인가 취소 — 진행 중인 state만 버린다. 앱 토큰·기존 노션 토큰·워크스페이스는 그대로 둔다.
 * 최초 연결이면 pending(미연결)으로, 연결 변경 중이면 기존 연결이 살아 있는 상태로 돌아간다.
 * 취소 뒤 돌아온 콜백은 state가 없으므로 `hasOauthState`에서 걸러진다. 멱등이다.
 */
export function cancelAuthorization(connectionId: string): void {
  db()
    .prepare(
      `UPDATE notion_connections
       SET oauth_state = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    )
    .run(connectionId);
}

/**
 * OAuth 콜백 — state로 세션을 찾아 노션 토큰·워크스페이스 정보를 저장한다. state는 1회용.
 * 직전과 다른 워크스페이스면 `workspaceChanged`로 알린다 (호출자가 색인 데이터를 폐기해야 한다).
 */
export function completeConnection(
  state: string,
  grant: WorkspaceGrant
): CompletedConnection | null {
  const previous = db()
    .prepare('SELECT workspace_id FROM notion_connections WHERE oauth_state = ?')
    .get(state) as { workspace_id: string | null } | undefined;

  const result = db()
    .prepare(
      `UPDATE notion_connections SET
         oauth_state = NULL,
         status = 'connected',
         access_token = ?,
         refresh_token = ?,
         bot_id = ?,
         workspace_id = ?,
         workspace_name = ?,
         workspace_icon = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE oauth_state = ?
       RETURNING ${CONNECTION_COLUMNS}`
    )
    .get(
      grant.accessToken,
      grant.refreshToken ?? null,
      grant.botId ?? null,
      grant.workspaceId ?? null,
      grant.workspaceName ?? null,
      grant.workspaceIcon ?? null,
      state
    ) as ConnectionRow | undefined;

  if (!result) return null;
  return {
    connection: toConnection(result),
    workspaceChanged: (previous?.workspace_id ?? null) !== (grant.workspaceId ?? null),
  };
}

/** 요청의 Bearer 앱 토큰으로 연결을 찾는다. */
export function findByAppToken(appToken: string): NotionConnection | null {
  const row = db()
    .prepare(`SELECT ${CONNECTION_COLUMNS} FROM notion_connections WHERE app_token_hash = ?`)
    .get(hashToken(appToken)) as ConnectionRow | undefined;
  return row ? toConnection(row) : null;
}

/** 액세스 토큰 갱신(refresh) 결과를 반영한다. */
export function updateConnectionTokens(connectionId: string, grant: WorkspaceGrant): void {
  db()
    .prepare(
      `UPDATE notion_connections
       SET access_token = ?, refresh_token = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    )
    .run(grant.accessToken, grant.refreshToken ?? null, connectionId);
}

/** 색인 대상 — 연결이 완료된 사용자 목록. */
export function listConnected(): NotionConnection[] {
  const rows = db()
    .prepare(
      `SELECT ${CONNECTION_COLUMNS} FROM notion_connections WHERE status = 'connected'`
    )
    .all() as ConnectionRow[];
  return rows.map(toConnection);
}
