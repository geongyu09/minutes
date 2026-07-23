import { randomBytes, randomUUID } from 'node:crypto';
import { db } from '@/db';

export interface NotionConnection {
  id: string;
  /** 연결은 프로젝트당 1개 — 색인 데이터도 이 연결에 귀속된다. */
  projectId: string;
  /** 색인용 노션 토큰의 소유자. 이 사람이 프로젝트를 떠나면 연결은 pending으로 되돌아간다. */
  connectedBy?: string;
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
  project_id: string;
  connected_by: string | null;
  status: 'pending' | 'connected';
  oauth_state: string | null;
  access_token: string | null;
  refresh_token: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
}

const CONNECTION_COLUMNS =
  'id, project_id, connected_by, status, oauth_state, access_token, refresh_token, workspace_id, workspace_name';

function toConnection(row: ConnectionRow): NotionConnection {
  return {
    id: row.id,
    projectId: row.project_id,
    connectedBy: row.connected_by ?? undefined,
    status: row.status,
    reconnecting: row.oauth_state !== null,
    accessToken: row.access_token ?? undefined,
    refreshToken: row.refresh_token ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    workspaceName: row.workspace_name ?? undefined,
  };
}

/**
 * 프로젝트의 노션 인가를 시작한다 — 연결이 없으면 만들고, 있으면 새 state만 발급한다(연결 변경).
 * 연결 변경은 기존 노션 토큰을 그대로 두므로 인가를 중도 포기해도 잃는 것이 없다.
 */
export function startConnection(projectId: string, userId: string): ConnectionSession {
  const state = randomBytes(32).toString('base64url');
  const existing = getConnectionByProject(projectId);

  if (existing) {
    db()
      .prepare(
        `UPDATE notion_connections
         SET oauth_state = ?, connected_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .run(state, userId, existing.id);
    return { connectionId: existing.id, state };
  }

  const connectionId = randomUUID();
  db()
    .prepare(
      'INSERT INTO notion_connections (id, project_id, connected_by, oauth_state) VALUES (?, ?, ?, ?)'
    )
    .run(connectionId, projectId, userId, state);
  return { connectionId, state };
}

/** 프로젝트의 노션 연결 — 검색·색인이 어느 색인 데이터를 볼지 결정한다. */
export function getConnectionByProject(projectId: string): NotionConnection | null {
  const row = db()
    .prepare(`SELECT ${CONNECTION_COLUMNS} FROM notion_connections WHERE project_id = ?`)
    .get(projectId) as ConnectionRow | undefined;
  return row ? toConnection(row) : null;
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
 * 인가 취소 — 진행 중인 state만 버린다. 기존 노션 토큰·워크스페이스는 그대로 둔다.
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

/**
 * 색인용 토큰의 소유자가 프로젝트를 떠났다 — 연결을 pending으로 되돌리고 노션 토큰을 버린다.
 * 토큰 소유자 없이 색인을 계속하지 않는다 (sharing.md). 색인된 데이터는 남는다.
 */
export function releaseConnectionOwner(projectId: string, userId: string): void {
  db()
    .prepare(
      `UPDATE notion_connections
       SET status = 'pending', access_token = NULL, refresh_token = NULL, oauth_state = NULL,
           connected_by = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE project_id = ? AND connected_by = ?`
    )
    .run(projectId, userId);
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
