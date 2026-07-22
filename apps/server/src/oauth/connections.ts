import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db } from '@/db';

export interface NotionConnection {
  id: string;
  status: 'pending' | 'connected';
  accessToken?: string;
  workspaceId?: string;
  workspaceName?: string;
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
  access_token: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toConnection(row: ConnectionRow): NotionConnection {
  return {
    id: row.id,
    status: row.status,
    accessToken: row.access_token ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    workspaceName: row.workspace_name ?? undefined,
  };
}

/** OAuth 시작 — 앱 토큰과 state를 발급하고 pending 연결을 만든다. 앱 토큰은 해시로만 저장. */
export function createPendingConnection(): ConnectionSession {
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

/** OAuth 콜백 — state로 세션을 찾아 노션 토큰·워크스페이스 정보를 저장한다. state는 1회용. */
export function completeConnection(state: string, grant: WorkspaceGrant): NotionConnection | null {
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
       RETURNING id, status, access_token, workspace_id, workspace_name`
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

  return result ? toConnection(result) : null;
}

/** 요청의 Bearer 앱 토큰으로 연결을 찾는다. */
export function findByAppToken(appToken: string): NotionConnection | null {
  const row = db()
    .prepare(
      `SELECT id, status, access_token, workspace_id, workspace_name
       FROM notion_connections WHERE app_token_hash = ?`
    )
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
      `SELECT id, status, access_token, workspace_id, workspace_name
       FROM notion_connections WHERE status = 'connected'`
    )
    .all() as ConnectionRow[];
  return rows.map(toConnection);
}
