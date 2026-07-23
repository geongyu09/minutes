import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { applyMigrations } from '@/migrations';
import { upsertUser, type User } from '@/auth/users';
import { createProject, getMembership } from './projects';
import { acceptInvite, createInvite, listInvites, revokeInvite } from './invites';

let owner: User;
let joiner: User;

beforeAll(() => {
  applyMigrations(db());
  owner = upsertUser({ notionUserId: 'i-owner' });
  joiner = upsertUser({ notionUserId: 'i-joiner' });
});

describe('createInvite', () => {
  it('추측 불가한 코드와 만료 시각을 발급한다', () => {
    const project = createProject('초대 대상', owner.id);
    const invite = createInvite(project.id, owner.id);

    expect(invite.code.length).toBeGreaterThanOrEqual(16);
    expect(new Date(invite.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(listInvites(project.id).map((i) => i.code)).toEqual([invite.code]);
  });
});

describe('acceptInvite', () => {
  it('유효한 코드면 member로 참여시킨다', () => {
    const project = createProject('참여', owner.id);
    const invite = createInvite(project.id, owner.id);

    expect(acceptInvite(invite.code, joiner.id)).toEqual({ projectId: project.id });
    expect(getMembership(project.id, joiner.id)?.role).toBe('member');
  });

  it('사용 횟수 제한이 없다 (팀 단위 배포 편의)', () => {
    const project = createProject('여러 명 참여', owner.id);
    const invite = createInvite(project.id, owner.id);
    const second = upsertUser({ notionUserId: 'i-joiner-2' });

    acceptInvite(invite.code, joiner.id);

    expect(acceptInvite(invite.code, second.id)).toEqual({ projectId: project.id });
  });

  it('없는 코드면 null', () => {
    expect(acceptInvite('없는-코드', joiner.id)).toBeNull();
  });

  it('폐기된 코드면 null', () => {
    const project = createProject('폐기', owner.id);
    const invite = createInvite(project.id, owner.id);

    revokeInvite(project.id, invite.code);

    expect(acceptInvite(invite.code, joiner.id)).toBeNull();
  });

  it('만료된 코드면 null', () => {
    const project = createProject('만료', owner.id);
    const invite = createInvite(project.id, owner.id);
    db()
      .prepare("UPDATE invites SET expires_at = '2000-01-01T00:00:00.000Z' WHERE code = ?")
      .run(invite.code);

    expect(acceptInvite(invite.code, joiner.id)).toBeNull();
  });

  it('이미 owner인 사람이 자기 코드를 써도 강등되지 않는다', () => {
    const project = createProject('자기 코드', owner.id);
    const invite = createInvite(project.id, owner.id);

    acceptInvite(invite.code, owner.id);

    expect(getMembership(project.id, owner.id)?.role).toBe('owner');
  });
});

describe('revokeInvite', () => {
  it('다른 프로젝트의 코드는 폐기할 수 없다', () => {
    const mine = createProject('내 것', owner.id);
    const other = createProject('남의 것', joiner.id);
    const invite = createInvite(other.id, joiner.id);

    expect(revokeInvite(mine.id, invite.code)).toBe(false);
    expect(acceptInvite(invite.code, owner.id)).not.toBeNull();
  });

  it('폐기된 코드는 목록에서 사라진다', () => {
    const project = createProject('목록', owner.id);
    const invite = createInvite(project.id, owner.id);

    expect(revokeInvite(project.id, invite.code)).toBe(true);
    expect(listInvites(project.id)).toEqual([]);
  });
});
