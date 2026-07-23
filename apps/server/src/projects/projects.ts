import { randomUUID } from 'node:crypto';
import { db } from '@/db';
import { releaseConnectionOwner } from '@/oauth/connections';

/** 역할은 owner / member 둘뿐이다 — 역할 추가는 필요가 증명되기 전까지 하지 않는다. */
export type Role = 'owner' | 'member';

export interface Project {
  id: string;
  name: string;
  createdBy: string;
}

/** 프로젝트 목록에 필요한 만큼만 — 노션 연결 여부를 함께 알려준다. */
export interface ProjectSummary {
  id: string;
  name: string;
  role: Role;
  connected: boolean;
  workspaceName?: string;
}

export interface Membership {
  projectId: string;
  userId: string;
  role: Role;
}

export interface Member {
  userId: string;
  role: Role;
  name?: string;
  email?: string;
}

/** 프로젝트 생성 — 만든 사람이 owner가 된다. */
export function createProject(name: string, userId: string): Project {
  const id = randomUUID();
  const create = db().transaction(() => {
    db().prepare('INSERT INTO projects (id, name, created_by) VALUES (?, ?, ?)').run(id, name, userId);
    db()
      .prepare("INSERT INTO memberships (project_id, user_id, role) VALUES (?, ?, 'owner')")
      .run(id, userId);
  });
  create();
  return { id, name, createdBy: userId };
}

export function listProjectsForUser(userId: string): ProjectSummary[] {
  const rows = db()
    .prepare(
      `SELECT p.id, p.name, m.role, c.status AS connection_status, c.workspace_name
       FROM memberships m
       JOIN projects p ON p.id = m.project_id
       LEFT JOIN notion_connections c ON c.project_id = p.id
       WHERE m.user_id = ?
       ORDER BY p.created_at`
    )
    .all(userId) as {
    id: string;
    name: string;
    role: Role;
    connection_status: string | null;
    workspace_name: string | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    connected: row.connection_status === 'connected',
    workspaceName: row.workspace_name ?? undefined,
  }));
}

/** 멤버십 검사의 단일 창구 — 라우팅 계층은 이 함수로만 프로젝트에 도달한다. */
export function getMembership(projectId: string, userId: string): Membership | null {
  const row = db()
    .prepare('SELECT role FROM memberships WHERE project_id = ? AND user_id = ?')
    .get(projectId, userId) as { role: Role } | undefined;
  return row ? { projectId, userId, role: row.role } : null;
}

/** 초대 수락 — 이미 멤버면 역할을 덮어쓰지 않는다 (owner가 강등되지 않게). */
export function addMember(projectId: string, userId: string, role: Role = 'member'): void {
  db()
    .prepare(
      `INSERT INTO memberships (project_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT(project_id, user_id) DO NOTHING`
    )
    .run(projectId, userId, role);
}

export function listMembers(projectId: string): Member[] {
  const rows = db()
    .prepare(
      `SELECT m.user_id, m.role, u.name, u.email
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.project_id = ?
       ORDER BY m.created_at`
    )
    .all(projectId) as { user_id: string; role: Role; name: string | null; email: string | null }[];

  return rows.map((row) => ({
    userId: row.user_id,
    role: row.role,
    name: row.name ?? undefined,
    email: row.email ?? undefined,
  }));
}

/** 멤버 내보내기 — 그 사람이 색인용 노션 토큰의 소유자였다면 연결을 pending으로 되돌린다. */
export function removeMember(projectId: string, userId: string): void {
  const remove = db().transaction(() => {
    db()
      .prepare('DELETE FROM memberships WHERE project_id = ? AND user_id = ?')
      .run(projectId, userId);
    releaseConnectionOwner(projectId, userId);
  });
  remove();
}

/** 프로젝트 삭제 — 멤버십·초대·연결(그리고 연결에 딸린 색인 데이터)이 CASCADE로 함께 사라진다. */
export function deleteProject(projectId: string): void {
  db().prepare('DELETE FROM projects WHERE id = ?').run(projectId);
}
