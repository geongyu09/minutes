import { describe, expect, it } from 'vitest';
import type { NotionConnection } from '@/oauth/connections';
import {
  authenticate,
  handleOauthCallback,
  handleOauthSession,
  handleOauthStatus,
} from './oauthHandlers';

const connected: NotionConnection = {
  id: 'conn-1',
  status: 'connected',
  accessToken: 'ntn-token',
  workspaceName: '우리 팀',
};

const pending: NotionConnection = { id: 'conn-2', status: 'pending' };

describe('authenticate', () => {
  it('Bearer 앱 토큰으로 연결을 찾는다', () => {
    const find = (token: string) => (token === 'app-token' ? connected : null);

    expect(authenticate('Bearer app-token', find)?.id).toBe('conn-1');
  });

  it('헤더가 없거나 형식이 다르면 null', () => {
    const find = () => connected;

    expect(authenticate(undefined, find)).toBeNull();
    expect(authenticate('Basic abc', find)).toBeNull();
    expect(authenticate('Bearer ', find)).toBeNull();
  });

  it('모르는 토큰이면 null', () => {
    expect(authenticate('Bearer nope', () => null)).toBeNull();
  });
});

describe('handleOauthSession', () => {
  it('앱 토큰과 인가 URL을 발급한다', () => {
    const res = handleOauthSession({
      createSession: () => ({ connectionId: 'c1', appToken: 'app-token', state: 'state-1' }),
      buildAuthUrl: (state) => `https://notion.example/authorize?state=${state}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.appToken).toBe('app-token');
    expect(res.body.authUrl).toBe('https://notion.example/authorize?state=state-1');
  });
});

describe('handleOauthCallback', () => {
  const deps = {
    hasPendingState: (state: string) => state === 'state-1',
    exchange: async (code: string) => {
      if (code !== 'good-code') throw new Error('invalid_grant');
      return { accessToken: 'ntn-token', botId: 'b1', workspaceId: 'w1', workspaceName: '우리 팀' };
    },
    complete: (state: string) => (state === 'state-1' ? connected : null),
  };

  it('code를 토큰으로 교환해 연결을 완료하고 성공 HTML을 반환한다', async () => {
    const res = await handleOauthCallback({ code: 'good-code', state: 'state-1' }, deps);

    expect(res.status).toBe(200);
    expect(res.html).toContain('연결');
  });

  it('노션이 error를 반환하면(사용자 취소) 400', async () => {
    const res = await handleOauthCallback({ error: 'access_denied' }, deps);
    expect(res.status).toBe(400);
  });

  it('code나 state가 없으면 400', async () => {
    expect((await handleOauthCallback({ state: 'state-1' }, deps)).status).toBe(400);
    expect((await handleOauthCallback({ code: 'good-code' }, deps)).status).toBe(400);
  });

  it('알 수 없는 state면 토큰 교환(외부 호출) 없이 400', async () => {
    let exchanged = false;
    const res = await handleOauthCallback(
      { code: 'good-code', state: 'unknown' },
      {
        ...deps,
        exchange: async (code) => {
          exchanged = true;
          return deps.exchange(code);
        },
        complete: () => null,
      }
    );

    expect(res.status).toBe(400);
    expect(exchanged).toBe(false); // state 선검증 — 무의미한 노션 API 호출을 막는다
  });
});

describe('handleOauthStatus', () => {
  it('연결 완료면 connected=true와 워크스페이스 이름을 반환한다', () => {
    const res = handleOauthStatus(connected);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true, workspaceName: '우리 팀' });
  });

  it('pending이면 connected=false', () => {
    const res = handleOauthStatus(pending);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
  });

  it('인증 실패면 401', () => {
    expect(handleOauthStatus(null).status).toBe(401);
  });
});
