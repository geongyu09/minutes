import { describe, expect, it, vi } from 'vitest';
import type { User } from '@/auth/users';
import type { Membership, Role } from '@/projects/projects';
import type { NotionConnection } from '@/oauth/connections';
import {
  handleOauthCallback,
  handleOauthCancel,
  handleOauthSession,
  handleOauthStatus,
} from './oauthHandlers';

const owner: User = { id: 'u-1', notionUserId: 'nu-1' };
const member: User = { id: 'u-2', notionUserId: 'nu-2' };

const roles: Record<string, Role> = { 'p-1:u-1': 'owner', 'p-1:u-2': 'member' };
const getMembership = (projectId: string, userId: string): Membership | null =>
  roles[`${projectId}:${userId}`]
    ? { projectId, userId, role: roles[`${projectId}:${userId}`] }
    : null;

const connected: NotionConnection = {
  id: 'conn-1',
  projectId: 'p-1',
  connectedBy: 'u-1',
  status: 'connected',
  reconnecting: false,
  accessToken: 'ntn-token',
  workspaceName: '우리 팀',
};

const buildAuthUrl = (state: string) => `https://notion.example/authorize?state=${state}`;

describe('handleOauthSession', () => {
  const deps = {
    getMembership,
    startConnection: vi.fn(() => ({ connectionId: 'conn-1', state: 'state-1' })),
    buildAuthUrl,
  };

  it('owner에게 프로젝트의 인가 URL을 발급한다', () => {
    const res = handleOauthSession(owner, 'p-1', deps);

    expect(res.status).toBe(200);
    expect(res.body.authUrl).toBe('https://notion.example/authorize?state=state-1');
    expect(deps.startConnection).toHaveBeenCalledWith('p-1', 'u-1');
  });

  it('member는 노션을 연결할 수 없다', () => {
    expect(handleOauthSession(member, 'p-1', deps).status).toBe(403);
  });

  it('비멤버는 403', () => {
    expect(handleOauthSession(owner, 'p-9', deps).status).toBe(403);
  });

  it('로그인하지 않았으면 401', () => {
    expect(handleOauthSession(null, 'p-1', deps).status).toBe(401);
  });
});

describe('handleOauthCancel', () => {
  const cancelAuthorization = vi.fn();
  const deps = { getMembership, getConnection: () => connected, cancelAuthorization };

  it('owner가 진행 중인 인가를 취소한다', () => {
    const res = handleOauthCancel(owner, 'p-1', deps);

    expect(res.status).toBe(200);
    expect(cancelAuthorization).toHaveBeenCalledWith('conn-1');
  });

  it('연결이 없어도 200 (취소는 멱등)', () => {
    const res = handleOauthCancel(owner, 'p-1', { ...deps, getConnection: () => null });

    expect(res.status).toBe(200);
  });

  it('member는 취소할 수 없다', () => {
    expect(handleOauthCancel(member, 'p-1', deps).status).toBe(403);
  });
});

describe('handleOauthStatus', () => {
  it('member도 연결 상태를 조회할 수 있다', () => {
    const res = handleOauthStatus(member, 'p-1', { getMembership, getConnection: () => connected });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true, reconnecting: false, workspaceName: '우리 팀' });
  });

  it('연결이 없으면 connected=false', () => {
    const res = handleOauthStatus(owner, 'p-1', { getMembership, getConnection: () => null });

    expect(res.body).toEqual({ connected: false, reconnecting: false });
  });

  it('연결 변경 중이면 reconnecting=true로 알린다', () => {
    const res = handleOauthStatus(owner, 'p-1', {
      getMembership,
      getConnection: () => ({ ...connected, reconnecting: true }),
    });

    expect(res.body.reconnecting).toBe(true);
  });

  it('비멤버는 403', () => {
    expect(
      handleOauthStatus(member, 'p-9', { getMembership, getConnection: () => connected }).status
    ).toBe(403);
  });
});

describe('handleOauthCallback', () => {
  const deps = () => ({
    hasOauthState: (state: string) => state === 'state-1',
    exchange: vi.fn(async () => ({ accessToken: 'ntn', workspaceId: 'ws-1' })),
    complete: vi.fn(() => ({ connection: connected, workspaceChanged: false })),
    purgeIndexedData: vi.fn(async () => {}),
  });

  it('code를 교환해 연결을 완료한다', async () => {
    const d = deps();
    const res = await handleOauthCallback({ code: 'c', state: 'state-1' }, d);

    expect(res.status).toBe(200);
    expect(d.complete).toHaveBeenCalled();
    expect(d.purgeIndexedData).not.toHaveBeenCalled();
  });

  it('워크스페이스가 바뀌면 이전 색인 데이터를 비운다', async () => {
    const d = { ...deps(), complete: vi.fn(() => ({ connection: connected, workspaceChanged: true })) };
    await handleOauthCallback({ code: 'c', state: 'state-1' }, d);

    expect(d.purgeIndexedData).toHaveBeenCalledWith('conn-1');
  });

  it('사용자가 인가를 거부하면 400', async () => {
    const res = await handleOauthCallback({ error: 'access_denied' }, deps());

    expect(res.status).toBe(400);
  });

  it('code나 state가 없으면 400', async () => {
    expect((await handleOauthCallback({ state: 'state-1' }, deps())).status).toBe(400);
    expect((await handleOauthCallback({ code: 'c' }, deps())).status).toBe(400);
  });

  it('모르는 state면 토큰 교환 없이 400', async () => {
    const d = deps();
    const res = await handleOauthCallback({ code: 'c', state: '없는-state' }, d);

    expect(res.status).toBe(400);
    expect(d.exchange).not.toHaveBeenCalled();
  });

  it('교환 뒤 state가 사라졌으면 400', async () => {
    const d = { ...deps(), complete: vi.fn(() => null) };
    const res = await handleOauthCallback({ code: 'c', state: 'state-1' }, d);

    expect(res.status).toBe(400);
  });
});
