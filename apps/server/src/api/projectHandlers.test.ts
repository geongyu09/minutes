import { describe, expect, it, vi } from 'vitest';
import type { User } from '@/auth/users';
import type { Membership, Role } from '@/projects/projects';
import {
  handleAcceptInvite,
  handleCreateInvite,
  handleCreateProject,
  handleDeleteProject,
  handleGetProject,
  handleRemoveMember,
  handleRevokeInvite,
  requireMembership,
} from './projectHandlers';

const user: User = { id: 'u-1', notionUserId: 'nu-1' };
const other: User = { id: 'u-2', notionUserId: 'nu-2' };

const membershipOf =
  (roles: Record<string, Role>) =>
  (projectId: string, userId: string): Membership | null =>
    roles[`${projectId}:${userId}`]
      ? { projectId, userId, role: roles[`${projectId}:${userId}`] }
      : null;

const getMembership = membershipOf({ 'p-1:u-1': 'owner', 'p-1:u-2': 'member' });

describe('requireMembership', () => {
  it('멤버면 통과시킨다', () => {
    const result = requireMembership(user, 'p-1', getMembership);

    expect(result.membership?.role).toBe('owner');
    expect(result.error).toBeUndefined();
  });

  it('로그인하지 않았으면 401', () => {
    expect(requireMembership(null, 'p-1', getMembership).error?.status).toBe(401);
  });

  it('projectId가 없으면 400', () => {
    expect(requireMembership(user, undefined, getMembership).error?.status).toBe(400);
  });

  it('비멤버면 403', () => {
    expect(requireMembership(user, 'p-9', getMembership).error?.status).toBe(403);
  });

  it('owner 전용 행위에 member가 접근하면 403', () => {
    expect(requireMembership(other, 'p-1', getMembership, 'owner').error?.status).toBe(403);
  });

  it('owner 전용 행위에 owner는 통과한다', () => {
    expect(requireMembership(user, 'p-1', getMembership, 'owner').error).toBeUndefined();
  });
});

describe('handleCreateProject', () => {
  const deps = { createProject: vi.fn(() => ({ id: 'p-9', name: '새 프로젝트', createdBy: 'u-1' })) };

  it('프로젝트를 만들고 201로 돌려준다', () => {
    const res = handleCreateProject(user, { name: '새 프로젝트' }, deps);

    expect(res.status).toBe(201);
    expect(res.body.project?.id).toBe('p-9');
    expect(deps.createProject).toHaveBeenCalledWith('새 프로젝트', 'u-1');
  });

  it('이름이 비어 있으면 400', () => {
    expect(handleCreateProject(user, { name: '   ' }, deps).status).toBe(400);
    expect(handleCreateProject(user, {}, deps).status).toBe(400);
  });

  it('로그인하지 않았으면 401', () => {
    expect(handleCreateProject(null, { name: 'x' }, deps).status).toBe(401);
  });
});

describe('handleDeleteProject', () => {
  it('owner만 삭제할 수 있다', () => {
    const deleteProject = vi.fn();

    expect(handleDeleteProject(other, 'p-1', { getMembership, deleteProject }).status).toBe(403);
    expect(deleteProject).not.toHaveBeenCalled();

    expect(handleDeleteProject(user, 'p-1', { getMembership, deleteProject }).status).toBe(200);
    expect(deleteProject).toHaveBeenCalledWith('p-1');
  });
});

describe('handleGetProject', () => {
  const deps = {
    getMembership,
    listMembers: () => [{ userId: 'u-1', role: 'owner' as Role }],
    listInvites: () => [{ code: 'inv-1', expiresAt: '2026-08-01T00:00:00.000Z' }],
  };

  it('멤버에게 멤버 목록을 보여준다', () => {
    const res = handleGetProject(other, 'p-1', deps);

    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
  });

  it('초대 코드는 owner에게만 보여준다', () => {
    expect(handleGetProject(other, 'p-1', deps).body.invites).toBeUndefined();
    expect(handleGetProject(user, 'p-1', deps).body.invites).toHaveLength(1);
  });
});

describe('handleCreateInvite', () => {
  const deps = {
    getMembership,
    createInvite: vi.fn(() => ({ code: 'inv-1', expiresAt: '2026-08-01T00:00:00.000Z' })),
  };

  it('owner가 코드를 만든다', () => {
    const res = handleCreateInvite(user, 'p-1', deps);

    expect(res.status).toBe(201);
    expect(res.body.invite?.code).toBe('inv-1');
  });

  it('member는 만들 수 없다', () => {
    expect(handleCreateInvite(other, 'p-1', deps).status).toBe(403);
  });
});

describe('handleRevokeInvite', () => {
  const deps = { getMembership, revokeInvite: (_p: string, code: string) => code === 'inv-1' };

  it('owner가 자기 프로젝트의 코드를 폐기한다', () => {
    expect(handleRevokeInvite(user, 'p-1', 'inv-1', deps).status).toBe(200);
  });

  it('없는 코드면 404', () => {
    expect(handleRevokeInvite(user, 'p-1', '없음', deps).status).toBe(404);
  });

  it('member는 폐기할 수 없다', () => {
    expect(handleRevokeInvite(other, 'p-1', 'inv-1', deps).status).toBe(403);
  });
});

describe('handleAcceptInvite', () => {
  const deps = {
    acceptInvite: (code: string) => (code === 'inv-1' ? { projectId: 'p-1' } : null),
  };

  it('유효한 코드면 참여한 프로젝트를 돌려준다', () => {
    const res = handleAcceptInvite(user, { code: 'inv-1' }, deps);

    expect(res.status).toBe(200);
    expect(res.body.projectId).toBe('p-1');
  });

  it('만료·폐기·오타를 구분하지 않고 같은 오류로 응답한다', () => {
    const res = handleAcceptInvite(user, { code: '틀린-코드' }, deps);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('유효하지 않은 초대 코드입니다');
  });

  it('코드가 없으면 400', () => {
    expect(handleAcceptInvite(user, {}, deps).status).toBe(400);
  });

  it('로그인하지 않았으면 401', () => {
    expect(handleAcceptInvite(null, { code: 'inv-1' }, deps).status).toBe(401);
  });
});

describe('handleRemoveMember', () => {
  const deps = { getMembership, removeMember: vi.fn() };

  it('owner가 멤버를 내보낸다', () => {
    const res = handleRemoveMember(user, 'p-1', 'u-2', deps);

    expect(res.status).toBe(200);
    expect(deps.removeMember).toHaveBeenCalledWith('p-1', 'u-2');
  });

  it('owner는 자기 자신을 내보낼 수 없다 (주인 없는 프로젝트 방지)', () => {
    expect(handleRemoveMember(user, 'p-1', 'u-1', deps).status).toBe(400);
  });

  it('member는 다른 사람을 내보낼 수 없다', () => {
    expect(handleRemoveMember(other, 'p-1', 'u-1', deps).status).toBe(403);
  });
});
