import { describe, expect, it, vi } from 'vitest';
import type { User } from '@/auth/users';
import {
  bearerToken,
  handleAuthCallback,
  handleAuthSession,
  handleAuthStatus,
  handleLogout,
  handleMe,
} from './authHandlers';

const user: User = { id: 'u-1', notionUserId: 'nu-1', name: '가영', email: 'a@example.com' };

describe('bearerToken', () => {
  it('Bearer 헤더에서 토큰을 꺼낸다', () => {
    expect(bearerToken('Bearer app-token')).toBe('app-token');
  });

  it('헤더가 없거나 형식이 다르면 null', () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer ')).toBeNull();
  });
});

describe('handleAuthSession', () => {
  it('폴링 토큰과 로그인 인가 URL을 발급한다', () => {
    const res = handleAuthSession({
      createSession: () => ({ pollToken: 'poll-1', state: 'state-1' }),
      buildAuthUrl: (state) => `https://notion.example/authorize?state=${state}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.pollToken).toBe('poll-1');
    expect(res.body.authUrl).toBe('https://notion.example/authorize?state=state-1');
  });
});

describe('handleAuthCallback', () => {
  const deps = () => ({
    hasLoginState: (state: string) => state === 'state-1',
    exchangeIdentity: vi.fn(async () => ({ notionUserId: 'nu-1', name: '가영' })),
    upsertUser: vi.fn(() => user),
    issueAppToken: vi.fn(() => 'app-token'),
    attachAppToken: vi.fn(() => true),
  });

  it('신원으로 계정을 만들고 앱 토큰을 세션에 준비한다', async () => {
    const d = deps();
    const res = await handleAuthCallback({ code: 'c', state: 'state-1' }, d);

    expect(res.status).toBe(200);
    expect(d.upsertUser).toHaveBeenCalledWith({ notionUserId: 'nu-1', name: '가영' });
    expect(d.issueAppToken).toHaveBeenCalledWith('u-1');
    expect(d.attachAppToken).toHaveBeenCalledWith('state-1', 'app-token');
  });

  it('사용자가 인가를 거부하면 400', async () => {
    const d = deps();
    const res = await handleAuthCallback({ error: 'access_denied' }, d);

    expect(res.status).toBe(400);
    expect(d.exchangeIdentity).not.toHaveBeenCalled();
  });

  it('code나 state가 없으면 400', async () => {
    expect((await handleAuthCallback({ state: 'state-1' }, deps())).status).toBe(400);
    expect((await handleAuthCallback({ code: 'c' }, deps())).status).toBe(400);
  });

  it('모르는(만료된) state면 토큰 교환 없이 400', async () => {
    const d = deps();
    const res = await handleAuthCallback({ code: 'c', state: '없는-state' }, d);

    expect(res.status).toBe(400);
    expect(d.exchangeIdentity).not.toHaveBeenCalled();
  });

  it('교환과 세션 부착 사이에 세션이 만료되면 400', async () => {
    const d = { ...deps(), attachAppToken: vi.fn(() => false) };
    const res = await handleAuthCallback({ code: 'c', state: 'state-1' }, d);

    expect(res.status).toBe(400);
  });
});

describe('handleAuthStatus', () => {
  it('아직 인가 전이면 authorized=false', () => {
    const res = handleAuthStatus('poll-1', { claimAppToken: () => null });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authorized: false });
  });

  it('인가가 끝났으면 앱 토큰을 한 번 내려준다', () => {
    const res = handleAuthStatus('poll-1', { claimAppToken: () => 'app-token' });

    expect(res.body).toEqual({ authorized: true, appToken: 'app-token' });
  });

  it('폴링 토큰이 없으면 401', () => {
    const res = handleAuthStatus(null, { claimAppToken: () => 'app-token' });

    expect(res.status).toBe(401);
  });
});

describe('handleLogout', () => {
  it('앱 토큰을 폐기한다', () => {
    const revoke = vi.fn();
    const res = handleLogout('app-token', { revokeAppToken: revoke });

    expect(res.status).toBe(200);
    expect(revoke).toHaveBeenCalledWith('app-token');
  });

  it('토큰이 없으면 401', () => {
    expect(handleLogout(null, { revokeAppToken: vi.fn() }).status).toBe(401);
  });
});

describe('handleMe', () => {
  it('내 계정과 소속 프로젝트 목록을 내려준다', () => {
    const res = handleMe(user, {
      listProjects: () => [{ id: 'p-1', name: '팀 회의록', role: 'owner', connected: true }],
    });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: 'u-1',
      name: '가영',
      email: 'a@example.com',
      avatarUrl: undefined,
    });
    expect(res.body.projects).toHaveLength(1);
  });

  it('로그인하지 않았으면 401', () => {
    expect(handleMe(null, { listProjects: () => [] }).status).toBe(401);
  });
});
