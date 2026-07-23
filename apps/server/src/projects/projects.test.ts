import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { applyMigrations } from '@/migrations';
import { upsertUser, type User } from '@/auth/users';
import { completeConnection, startConnection } from '@/oauth/connections';
import {
  addMember,
  createProject,
  deleteProject,
  getMembership,
  listMembers,
  listProjectsForUser,
  removeMember,
} from './projects';

let owner: User;
let member: User;

beforeAll(() => {
  applyMigrations(db());
  owner = upsertUser({ notionUserId: 'p-owner', name: '가영' });
  member = upsertUser({ notionUserId: 'p-member', name: '나연' });
});

describe('createProject', () => {
  it('만든 사람이 owner 멤버가 된다', () => {
    const project = createProject('팀 회의록', owner.id);

    expect(project.id).toBeTruthy();
    expect(project.name).toBe('팀 회의록');
    expect(getMembership(project.id, owner.id)?.role).toBe('owner');
  });
});

describe('listProjectsForUser', () => {
  it('소속된 프로젝트만 역할과 함께 돌려준다', () => {
    const mine = createProject('내 프로젝트', owner.id);
    createProject('남의 프로젝트', member.id);

    const projects = listProjectsForUser(owner.id);

    expect(projects.map((p) => p.id)).toContain(mine.id);
    expect(projects.map((p) => p.name)).not.toContain('남의 프로젝트');
    expect(projects.find((p) => p.id === mine.id)?.role).toBe('owner');
  });

  it('노션 연결 여부를 함께 알려준다', () => {
    const project = createProject('연결 있는 프로젝트', owner.id);
    const session = startConnection(project.id, owner.id);
    completeConnection(session.state, { accessToken: 'ntn', workspaceName: '우리 팀' });

    const found = listProjectsForUser(owner.id).find((p) => p.id === project.id);

    expect(found?.connected).toBe(true);
    expect(found?.workspaceName).toBe('우리 팀');
  });

  it('연결 전이면 connected=false', () => {
    const project = createProject('연결 없는 프로젝트', owner.id);

    expect(listProjectsForUser(owner.id).find((p) => p.id === project.id)?.connected).toBe(false);
  });
});

describe('getMembership', () => {
  it('멤버가 아니면 null', () => {
    const project = createProject('비공개', owner.id);

    expect(getMembership(project.id, member.id)).toBeNull();
  });
});

describe('addMember / listMembers / removeMember', () => {
  it('멤버로 추가하면 member 역할이 된다', () => {
    const project = createProject('참여 대상', owner.id);
    addMember(project.id, member.id);

    expect(getMembership(project.id, member.id)?.role).toBe('member');
    expect(listMembers(project.id).map((m) => m.userId).sort()).toEqual(
      [owner.id, member.id].sort()
    );
  });

  it('이미 멤버면 역할을 덮어쓰지 않는다 (owner가 강등되지 않는다)', () => {
    const project = createProject('중복 참여', owner.id);
    addMember(project.id, owner.id);

    expect(getMembership(project.id, owner.id)?.role).toBe('owner');
  });

  it('내보낸 멤버는 더 이상 멤버가 아니다', () => {
    const project = createProject('내보내기', owner.id);
    addMember(project.id, member.id);

    removeMember(project.id, member.id);

    expect(getMembership(project.id, member.id)).toBeNull();
  });

  it('연결한 사람이 나가면 연결을 pending으로 되돌리고 노션 토큰을 버린다', () => {
    const project = createProject('연결자 이탈', owner.id);
    addMember(project.id, member.id);
    const session = startConnection(project.id, member.id);
    completeConnection(session.state, { accessToken: 'ntn', workspaceId: 'ws-1' });

    removeMember(project.id, member.id);

    const row = db()
      .prepare('SELECT status, access_token FROM notion_connections WHERE project_id = ?')
      .get(project.id) as { status: string; access_token: string | null };
    expect(row.status).toBe('pending');
    expect(row.access_token).toBeNull();
  });
});

describe('deleteProject', () => {
  it('프로젝트를 지우면 멤버십과 연결(색인 데이터)도 함께 사라진다', () => {
    const project = createProject('삭제 대상', owner.id);
    addMember(project.id, member.id);
    startConnection(project.id, owner.id);

    deleteProject(project.id);

    expect(getMembership(project.id, owner.id)).toBeNull();
    expect(
      db().prepare('SELECT 1 FROM notion_connections WHERE project_id = ?').get(project.id)
    ).toBeUndefined();
  });
});
