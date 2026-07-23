import type { User } from '@/auth/users';
import type { Invite } from '@/projects/invites';
import type { Member, Membership, Project, Role } from '@/projects/projects';

export interface HandlerError {
  status: number;
  body: { error: string };
}

export interface MembershipCheck {
  membership?: Membership;
  error?: HandlerError;
}

/**
 * 멤버십 검사의 단일 창구 — 프로젝트에 닿는 모든 요청이 여기를 지난다.
 * 검사를 라우팅 계층 한 곳에 모아두지 않으면, 새 엔드포인트 하나에서 빠뜨렸을 때 곧바로 교차 유출이다.
 */
export function requireMembership(
  user: User | null,
  projectId: string | undefined,
  getMembership: (projectId: string, userId: string) => Membership | null,
  requiredRole?: Role
): MembershipCheck {
  if (!user) {
    return { error: { status: 401, body: { error: '로그인이 필요합니다' } } };
  }
  if (!projectId) {
    return { error: { status: 400, body: { error: 'projectId가 필요합니다' } } };
  }
  const membership = getMembership(projectId, user.id);
  // 비멤버에게는 프로젝트 존재 여부도 알려주지 않는다 — 403 하나로 응답한다
  if (!membership) {
    return { error: { status: 403, body: { error: '이 프로젝트에 접근할 수 없습니다' } } };
  }
  if (requiredRole === 'owner' && membership.role !== 'owner') {
    return { error: { status: 403, body: { error: '프로젝트 소유자만 할 수 있습니다' } } };
  }
  return { membership };
}

export interface ProjectResult {
  status: number;
  body: { project?: Project; error?: string };
}

/** POST /projects — 만든 사람이 owner가 된다. */
export function handleCreateProject(
  user: User | null,
  body: unknown,
  deps: { createProject: (name: string, userId: string) => Project }
): ProjectResult {
  if (!user) return { status: 401, body: { error: '로그인이 필요합니다' } };

  const { name } = (body ?? {}) as { name?: unknown };
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { status: 400, body: { error: '프로젝트 이름이 필요합니다' } };
  }
  return { status: 201, body: { project: deps.createProject(name.trim(), user.id) } };
}

export interface SimpleResult {
  status: number;
  body: Record<string, unknown>;
}

/** DELETE /projects/:id — 색인 데이터까지 함께 사라진다. owner만 가능. */
export function handleDeleteProject(
  user: User | null,
  projectId: string | undefined,
  deps: {
    getMembership: (projectId: string, userId: string) => Membership | null;
    deleteProject: (projectId: string) => void;
  }
): SimpleResult {
  const check = requireMembership(user, projectId, deps.getMembership, 'owner');
  if (check.error) return check.error;

  deps.deleteProject(projectId!);
  return { status: 200, body: { deleted: true } };
}

export interface ProjectDetailResult {
  status: number;
  body: { role?: Role; members?: Member[]; invites?: Invite[]; error?: string };
}

/** GET /projects/:id — 프로젝트 설정 화면. 초대 코드는 owner에게만 내려간다. */
export function handleGetProject(
  user: User | null,
  projectId: string | undefined,
  deps: {
    getMembership: (projectId: string, userId: string) => Membership | null;
    listMembers: (projectId: string) => Member[];
    listInvites: (projectId: string) => Invite[];
  }
): ProjectDetailResult {
  const check = requireMembership(user, projectId, deps.getMembership);
  if (check.error) return check.error;

  const isOwner = check.membership!.role === 'owner';
  return {
    status: 200,
    body: {
      role: check.membership!.role,
      members: deps.listMembers(projectId!),
      ...(isOwner ? { invites: deps.listInvites(projectId!) } : {}),
    },
  };
}

export interface InviteResult {
  status: number;
  body: { invite?: Invite; error?: string };
}

/** POST /projects/:id/invites — owner가 코드를 만들어 메신저로 직접 전달한다. */
export function handleCreateInvite(
  user: User | null,
  projectId: string | undefined,
  deps: {
    getMembership: (projectId: string, userId: string) => Membership | null;
    createInvite: (projectId: string, userId: string) => Invite;
  }
): InviteResult {
  const check = requireMembership(user, projectId, deps.getMembership, 'owner');
  if (check.error) return check.error;

  return { status: 201, body: { invite: deps.createInvite(projectId!, user!.id) } };
}

/** DELETE /projects/:id/invites/:code */
export function handleRevokeInvite(
  user: User | null,
  projectId: string | undefined,
  code: string | undefined,
  deps: {
    getMembership: (projectId: string, userId: string) => Membership | null;
    revokeInvite: (projectId: string, code: string) => boolean;
  }
): SimpleResult {
  const check = requireMembership(user, projectId, deps.getMembership, 'owner');
  if (check.error) return check.error;

  if (!code || !deps.revokeInvite(projectId!, code)) {
    return { status: 404, body: { error: '초대 코드를 찾을 수 없습니다' } };
  }
  return { status: 200, body: { revoked: true } };
}

export interface AcceptInviteResult {
  status: number;
  body: { projectId?: string; error?: string };
}

/** POST /invites/accept — 코드 하나로 참여한다. 참여 즉시 검색이 가능하다. */
export function handleAcceptInvite(
  user: User | null,
  body: unknown,
  deps: { acceptInvite: (code: string, userId: string) => { projectId: string } | null }
): AcceptInviteResult {
  if (!user) return { status: 401, body: { error: '로그인이 필요합니다' } };

  const { code } = (body ?? {}) as { code?: unknown };
  if (typeof code !== 'string' || code.trim().length === 0) {
    return { status: 400, body: { error: '초대 코드가 필요합니다' } };
  }

  const result = deps.acceptInvite(code.trim(), user.id);
  // 만료·폐기·오타를 구분하지 않는다 — 코드 존재 여부를 노출하지 않기 위해서다
  if (!result) {
    return { status: 404, body: { error: '유효하지 않은 초대 코드입니다' } };
  }
  return { status: 200, body: { projectId: result.projectId } };
}

/** DELETE /projects/:id/members/:userId */
export function handleRemoveMember(
  user: User | null,
  projectId: string | undefined,
  targetUserId: string | undefined,
  deps: {
    getMembership: (projectId: string, userId: string) => Membership | null;
    removeMember: (projectId: string, userId: string) => void;
  }
): SimpleResult {
  const check = requireMembership(user, projectId, deps.getMembership, 'owner');
  if (check.error) return check.error;

  if (!targetUserId) {
    return { status: 400, body: { error: '내보낼 멤버가 필요합니다' } };
  }
  // owner가 스스로 나가면 초대·연결을 할 수 있는 사람이 사라진다 — 프로젝트 삭제로 유도한다
  if (targetUserId === user!.id) {
    return { status: 400, body: { error: '소유자는 스스로를 내보낼 수 없습니다' } };
  }

  deps.removeMember(projectId!, targetUserId);
  return { status: 200, body: { removed: true } };
}
