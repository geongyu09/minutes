import { randomBytes } from 'node:crypto';
import { db } from '@/db';
import { addMember } from './projects';

/** 이메일 발송 인프라 없이 초대를 성립시키는 수단 — owner가 코드를 만들어 직접 전달한다. */
export interface Invite {
  code: string;
  expiresAt: string;
}

// 기본 유효기간. 폐기는 owner가 언제든 할 수 있으므로 길게 두지 않는다.
const INVITE_TTL = '+7 days';

const LIVE = "revoked_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export function createInvite(projectId: string, userId: string): Invite {
  const code = randomBytes(16).toString('base64url');
  const row = db()
    .prepare(
      `INSERT INTO invites (code, project_id, created_by, expires_at)
       VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?))
       RETURNING expires_at`
    )
    .get(code, projectId, userId, INVITE_TTL) as { expires_at: string };
  return { code, expiresAt: row.expires_at };
}

/** 살아 있는 초대 코드만 보여준다 — 폐기·만료된 코드는 목록에서 사라진다. */
export function listInvites(projectId: string): Invite[] {
  const rows = db()
    .prepare(`SELECT code, expires_at FROM invites WHERE project_id = ? AND ${LIVE} ORDER BY created_at`)
    .all(projectId) as { code: string; expires_at: string }[];
  return rows.map((r) => ({ code: r.code, expiresAt: r.expires_at }));
}

/** 코드 폐기. 다른 프로젝트의 코드는 건드릴 수 없다. */
export function revokeInvite(projectId: string, code: string): boolean {
  const result = db()
    .prepare(
      `UPDATE invites SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE code = ? AND project_id = ? AND revoked_at IS NULL`
    )
    .run(code, projectId);
  return result.changes > 0;
}

/**
 * 코드로 프로젝트에 참여한다. 사용 횟수 제한은 없다.
 * 실패 이유(없음·만료·폐기)를 구분해 돌려주지 않는다 — 코드 존재 여부를 노출하지 않기 위해서다.
 */
export function acceptInvite(code: string, userId: string): { projectId: string } | null {
  const row = db()
    .prepare(`SELECT project_id FROM invites WHERE code = ? AND ${LIVE}`)
    .get(code) as { project_id: string } | undefined;
  if (!row) return null;

  addMember(row.project_id, userId);
  return { projectId: row.project_id };
}
