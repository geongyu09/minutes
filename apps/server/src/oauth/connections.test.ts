import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { applyMigrations } from '@/migrations';
import {
  cancelAuthorization,
  completeConnection,
  createPendingConnection,
  findByAppToken,
  hasOauthState,
  listConnected,
  startReconnect,
  updateConnectionTokens,
} from './connections';

const workspace = {
  accessToken: 'secret-access-token',
  botId: 'bot-1',
  workspaceId: 'ws-1',
  workspaceName: '우리 팀',
  workspaceIcon: '🧭',
};

beforeAll(() => {
  applyMigrations(db());
});

describe('createPendingConnection', () => {
  it('연결 ID·앱 토큰·state를 발급하고 pending 상태로 저장한다', () => {
    const session = createPendingConnection();

    expect(session.connectionId).toBeTruthy();
    expect(session.appToken).toBeTruthy();
    expect(session.state).toBeTruthy();

    const found = findByAppToken(session.appToken);
    expect(found?.id).toBe(session.connectionId);
    expect(found?.status).toBe('pending');
  });

  it('앱 토큰을 평문으로 저장하지 않는다 (해시만 저장)', () => {
    const session = createPendingConnection();
    const row = db()
      .prepare('SELECT app_token_hash FROM notion_connections WHERE id = ?')
      .get(session.connectionId) as { app_token_hash: string };

    expect(row.app_token_hash).not.toBe(session.appToken);
    expect(row.app_token_hash).not.toContain(session.appToken);
  });

  it('호출마다 서로 다른 토큰과 state를 발급한다', () => {
    const a = createPendingConnection();
    const b = createPendingConnection();

    expect(a.appToken).not.toBe(b.appToken);
    expect(a.state).not.toBe(b.state);
  });

  it('수명이 지난 pending 연결을 정리한다 (connected는 유지)', () => {
    const stale = createPendingConnection();
    const done = createPendingConnection();
    completeConnection(done.state, workspace);
    // 두 시간 전에 만들어진 것으로 되돌린다
    db()
      .prepare(
        `UPDATE notion_connections
         SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours')
         WHERE id IN (?, ?)`
      )
      .run(stale.connectionId, done.connectionId);

    createPendingConnection();

    expect(findByAppToken(stale.appToken)).toBeNull();
    expect(findByAppToken(done.appToken)?.status).toBe('connected');
  });
});

describe('hasOauthState', () => {
  it('발급된 state는 true, 완료되었거나 모르는 state는 false', () => {
    const session = createPendingConnection();

    expect(hasOauthState(session.state)).toBe(true);
    expect(hasOauthState('unknown-state')).toBe(false);

    completeConnection(session.state, workspace);
    expect(hasOauthState(session.state)).toBe(false);
  });

  it('연결 변경으로 발급된 state도 true (이미 connected여도 인가 진행 중)', () => {
    const session = createPendingConnection();
    completeConnection(session.state, workspace);
    const state = startReconnect(session.connectionId);

    expect(hasOauthState(state!)).toBe(true);
  });
});

describe('startReconnect', () => {
  it('connected 연결에 새 state를 발급하되 연결 자체는 살려둔다', () => {
    const session = createPendingConnection();
    completeConnection(session.state, workspace);

    const state = startReconnect(session.connectionId);

    expect(state).toBeTruthy();
    expect(state).not.toBe(session.state);

    // 인가가 끝나기 전에도 기존 워크스페이스로 검색·색인이 계속되어야 한다
    const found = findByAppToken(session.appToken);
    expect(found?.status).toBe('connected');
    expect(found?.accessToken).toBe(workspace.accessToken);
    expect(found?.reconnecting).toBe(true);
  });

  it('모르는 연결이면 null', () => {
    expect(startReconnect('no-such-connection')).toBeNull();
  });

  it('재연결이 완료되면 새 워크스페이스로 바뀌고 reconnecting이 꺼진다', () => {
    const session = createPendingConnection();
    completeConnection(session.state, workspace);
    const state = startReconnect(session.connectionId)!;

    const result = completeConnection(state, {
      accessToken: 'other-access-token',
      workspaceId: 'ws-2',
      workspaceName: '다른 팀',
    });

    expect(result?.workspaceChanged).toBe(true);
    const found = findByAppToken(session.appToken);
    expect(found?.workspaceName).toBe('다른 팀');
    expect(found?.accessToken).toBe('other-access-token');
    expect(found?.reconnecting).toBe(false);
  });

  it('같은 워크스페이스를 다시 고르면 workspaceChanged=false (색인 데이터 유지 판단용)', () => {
    const session = createPendingConnection();
    completeConnection(session.state, workspace);
    const state = startReconnect(session.connectionId)!;

    const result = completeConnection(state, { ...workspace, accessToken: 'refreshed' });

    expect(result?.workspaceChanged).toBe(false);
  });
});

describe('cancelAuthorization', () => {
  it('최초 연결 취소 — state를 지우고 pending으로 남긴다', () => {
    const session = createPendingConnection();

    cancelAuthorization(session.connectionId);

    expect(hasOauthState(session.state)).toBe(false);
    const found = findByAppToken(session.appToken);
    expect(found?.status).toBe('pending');
    expect(found?.reconnecting).toBe(false);
  });

  it('연결 변경 취소 — 기존 연결과 토큰은 그대로 살아 있다', () => {
    const session = createPendingConnection();
    completeConnection(session.state, workspace);
    const state = startReconnect(session.connectionId)!;

    cancelAuthorization(session.connectionId);

    expect(hasOauthState(state)).toBe(false);
    const found = findByAppToken(session.appToken);
    expect(found?.status).toBe('connected');
    expect(found?.accessToken).toBe(workspace.accessToken);
    expect(found?.workspaceName).toBe('우리 팀');
    expect(found?.reconnecting).toBe(false);
  });

  it('취소된 state로는 연결을 완료할 수 없다', () => {
    const session = createPendingConnection();

    cancelAuthorization(session.connectionId);

    expect(completeConnection(session.state, workspace)).toBeNull();
  });

  it('진행 중인 인가가 없어도 오류 없이 동작한다 (멱등)', () => {
    const session = createPendingConnection();
    cancelAuthorization(session.connectionId);

    expect(() => cancelAuthorization(session.connectionId)).not.toThrow();
    expect(() => cancelAuthorization('no-such-connection')).not.toThrow();
  });
});

describe('completeConnection', () => {
  it('state로 세션을 찾아 노션 토큰·워크스페이스 정보를 저장하고 connected로 바꾼다', () => {
    const session = createPendingConnection();
    const result = completeConnection(session.state, workspace);
    const connection = result?.connection;

    expect(connection?.id).toBe(session.connectionId);
    expect(connection?.status).toBe('connected');
    expect(connection?.accessToken).toBe(workspace.accessToken);
    expect(connection?.workspaceName).toBe('우리 팀');
    expect(result?.workspaceChanged).toBe(true); // 최초 연결도 "빈 상태 → 워크스페이스" 변경
  });

  it('알 수 없는 state면 null을 반환한다', () => {
    expect(completeConnection('unknown-state', workspace)).toBeNull();
  });

  it('완료된 state는 재사용할 수 없다', () => {
    const session = createPendingConnection();
    completeConnection(session.state, workspace);

    expect(completeConnection(session.state, workspace)).toBeNull();
  });
});

describe('findByAppToken', () => {
  it('연결 완료 후 앱 토큰으로 액세스 토큰을 조회할 수 있다', () => {
    const session = createPendingConnection();
    completeConnection(session.state, workspace);

    const found = findByAppToken(session.appToken);
    expect(found?.status).toBe('connected');
    expect(found?.accessToken).toBe(workspace.accessToken);
  });

  it('잘못된 토큰이면 null을 반환한다', () => {
    expect(findByAppToken('no-such-token')).toBeNull();
  });
});

describe('updateConnectionTokens', () => {
  it('갱신된 액세스 토큰을 저장한다', () => {
    const session = createPendingConnection();
    completeConnection(session.state, workspace);

    updateConnectionTokens(session.connectionId, { accessToken: 'renewed-token' });

    expect(findByAppToken(session.appToken)?.accessToken).toBe('renewed-token');
  });
});

describe('listConnected', () => {
  it('connected 상태의 연결만 반환한다', () => {
    const pending = createPendingConnection();
    const done = createPendingConnection();
    completeConnection(done.state, workspace);

    const ids = listConnected().map((c) => c.id);
    expect(ids).toContain(done.connectionId);
    expect(ids).not.toContain(pending.connectionId);
  });
});
