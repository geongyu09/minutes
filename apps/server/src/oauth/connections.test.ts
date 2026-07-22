import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { applyMigrations } from '@/migrations';
import {
  completeConnection,
  createPendingConnection,
  findByAppToken,
  hasPendingState,
  listConnected,
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

describe('hasPendingState', () => {
  it('발급된 state는 true, 완료되었거나 모르는 state는 false', () => {
    const session = createPendingConnection();

    expect(hasPendingState(session.state)).toBe(true);
    expect(hasPendingState('unknown-state')).toBe(false);

    completeConnection(session.state, workspace);
    expect(hasPendingState(session.state)).toBe(false);
  });
});

describe('completeConnection', () => {
  it('state로 세션을 찾아 노션 토큰·워크스페이스 정보를 저장하고 connected로 바꾼다', () => {
    const session = createPendingConnection();
    const connection = completeConnection(session.state, workspace);

    expect(connection?.id).toBe(session.connectionId);
    expect(connection?.status).toBe('connected');
    expect(connection?.accessToken).toBe(workspace.accessToken);
    expect(connection?.workspaceName).toBe('우리 팀');
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
