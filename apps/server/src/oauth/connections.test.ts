import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { applyMigrations } from '@/migrations';
import { upsertUser, type User } from '@/auth/users';
import { createProject } from '@/projects/projects';
import {
  cancelAuthorization,
  completeConnection,
  getConnectionByProject,
  hasOauthState,
  listConnected,
  releaseConnectionOwner,
  startConnection,
  updateConnectionTokens,
} from './connections';

const workspace = {
  accessToken: 'secret-access-token',
  botId: 'bot-1',
  workspaceId: 'ws-1',
  workspaceName: '우리 팀',
  workspaceIcon: '🧭',
};

let user: User;
let projectSeq = 0;

/** 테스트마다 새 프로젝트 — 연결은 프로젝트당 1개이므로 서로 간섭하지 않게 한다. */
function newProject(): string {
  projectSeq += 1;
  return createProject(`프로젝트 ${projectSeq}`, user.id).id;
}

beforeAll(() => {
  applyMigrations(db());
  user = upsertUser({ notionUserId: 'conn-user' });
});

describe('startConnection', () => {
  it('프로젝트에 pending 연결과 state를 만든다', () => {
    const projectId = newProject();
    const session = startConnection(projectId, user.id);

    expect(session.connectionId).toBeTruthy();
    expect(session.state).toBeTruthy();

    const connection = getConnectionByProject(projectId);
    expect(connection?.id).toBe(session.connectionId);
    expect(connection?.status).toBe('pending');
    expect(connection?.connectedBy).toBe(user.id);
  });

  it('호출마다 서로 다른 state를 발급한다', () => {
    expect(startConnection(newProject(), user.id).state).not.toBe(
      startConnection(newProject(), user.id).state
    );
  });

  it('이미 연결된 프로젝트에서 다시 부르면 연결 변경이 된다 (기존 연결은 살아 있다)', () => {
    const projectId = newProject();
    const first = startConnection(projectId, user.id);
    completeConnection(first.state, workspace);

    const second = startConnection(projectId, user.id);

    expect(second.connectionId).toBe(first.connectionId);
    expect(second.state).not.toBe(first.state);

    // 인가가 끝나기 전에도 기존 워크스페이스로 검색·색인이 계속되어야 한다
    const connection = getConnectionByProject(projectId);
    expect(connection?.status).toBe('connected');
    expect(connection?.accessToken).toBe(workspace.accessToken);
    expect(connection?.reconnecting).toBe(true);
  });
});

describe('getConnectionByProject', () => {
  it('연결이 없는 프로젝트면 null', () => {
    expect(getConnectionByProject(newProject())).toBeNull();
  });
});

describe('hasOauthState', () => {
  it('발급된 state는 true, 완료되었거나 모르는 state는 false', () => {
    const session = startConnection(newProject(), user.id);

    expect(hasOauthState(session.state)).toBe(true);
    expect(hasOauthState('unknown-state')).toBe(false);

    completeConnection(session.state, workspace);
    expect(hasOauthState(session.state)).toBe(false);
  });

  it('연결 변경으로 발급된 state도 true (이미 connected여도 인가 진행 중)', () => {
    const projectId = newProject();
    const first = startConnection(projectId, user.id);
    completeConnection(first.state, workspace);

    expect(hasOauthState(startConnection(projectId, user.id).state)).toBe(true);
  });
});

describe('completeConnection', () => {
  it('state로 세션을 찾아 노션 토큰·워크스페이스 정보를 저장하고 connected로 바꾼다', () => {
    const projectId = newProject();
    const session = startConnection(projectId, user.id);

    const result = completeConnection(session.state, workspace);

    expect(result?.connection.id).toBe(session.connectionId);
    expect(result?.connection.status).toBe('connected');
    expect(result?.connection.accessToken).toBe(workspace.accessToken);
    expect(result?.connection.workspaceName).toBe('우리 팀');
    expect(result?.workspaceChanged).toBe(true); // 최초 연결도 "빈 상태 → 워크스페이스" 변경
  });

  it('재연결이 완료되면 새 워크스페이스로 바뀌고 reconnecting이 꺼진다', () => {
    const projectId = newProject();
    completeConnection(startConnection(projectId, user.id).state, workspace);
    const state = startConnection(projectId, user.id).state;

    const result = completeConnection(state, {
      accessToken: 'other-access-token',
      workspaceId: 'ws-2',
      workspaceName: '다른 팀',
    });

    expect(result?.workspaceChanged).toBe(true);
    const connection = getConnectionByProject(projectId);
    expect(connection?.workspaceName).toBe('다른 팀');
    expect(connection?.accessToken).toBe('other-access-token');
    expect(connection?.reconnecting).toBe(false);
  });

  it('같은 워크스페이스를 다시 고르면 workspaceChanged=false (색인 데이터 유지 판단용)', () => {
    const projectId = newProject();
    completeConnection(startConnection(projectId, user.id).state, workspace);
    const state = startConnection(projectId, user.id).state;

    expect(completeConnection(state, { ...workspace, accessToken: 'refreshed' })?.workspaceChanged).toBe(
      false
    );
  });

  it('알 수 없는 state면 null을 반환한다', () => {
    expect(completeConnection('unknown-state', workspace)).toBeNull();
  });

  it('완료된 state는 재사용할 수 없다', () => {
    const session = startConnection(newProject(), user.id);
    completeConnection(session.state, workspace);

    expect(completeConnection(session.state, workspace)).toBeNull();
  });
});

describe('cancelAuthorization', () => {
  it('최초 연결 취소 — state를 지우고 pending으로 남긴다', () => {
    const projectId = newProject();
    const session = startConnection(projectId, user.id);

    cancelAuthorization(session.connectionId);

    expect(hasOauthState(session.state)).toBe(false);
    const connection = getConnectionByProject(projectId);
    expect(connection?.status).toBe('pending');
    expect(connection?.reconnecting).toBe(false);
  });

  it('연결 변경 취소 — 기존 연결과 토큰은 그대로 살아 있다', () => {
    const projectId = newProject();
    const first = startConnection(projectId, user.id);
    completeConnection(first.state, workspace);
    const state = startConnection(projectId, user.id).state;

    cancelAuthorization(first.connectionId);

    expect(hasOauthState(state)).toBe(false);
    const connection = getConnectionByProject(projectId);
    expect(connection?.status).toBe('connected');
    expect(connection?.accessToken).toBe(workspace.accessToken);
    expect(connection?.workspaceName).toBe('우리 팀');
    expect(connection?.reconnecting).toBe(false);
  });

  it('취소된 state로는 연결을 완료할 수 없다', () => {
    const session = startConnection(newProject(), user.id);

    cancelAuthorization(session.connectionId);

    expect(completeConnection(session.state, workspace)).toBeNull();
  });

  it('진행 중인 인가가 없어도 오류 없이 동작한다 (멱등)', () => {
    const session = startConnection(newProject(), user.id);
    cancelAuthorization(session.connectionId);

    expect(() => cancelAuthorization(session.connectionId)).not.toThrow();
    expect(() => cancelAuthorization('no-such-connection')).not.toThrow();
  });
});

describe('releaseConnectionOwner', () => {
  it('토큰 소유자가 떠나면 pending으로 되돌리고 노션 토큰을 버린다', () => {
    const projectId = newProject();
    completeConnection(startConnection(projectId, user.id).state, workspace);

    releaseConnectionOwner(projectId, user.id);

    const connection = getConnectionByProject(projectId);
    expect(connection?.status).toBe('pending');
    expect(connection?.accessToken).toBeUndefined();
    expect(connection?.connectedBy).toBeUndefined();
  });

  it('다른 사람이 떠난 것이면 연결을 건드리지 않는다', () => {
    const projectId = newProject();
    completeConnection(startConnection(projectId, user.id).state, workspace);

    releaseConnectionOwner(projectId, '남');

    expect(getConnectionByProject(projectId)?.status).toBe('connected');
  });
});

describe('updateConnectionTokens', () => {
  it('갱신된 액세스 토큰을 저장한다', () => {
    const projectId = newProject();
    const session = startConnection(projectId, user.id);
    completeConnection(session.state, workspace);

    updateConnectionTokens(session.connectionId, { accessToken: 'renewed-token' });

    expect(getConnectionByProject(projectId)?.accessToken).toBe('renewed-token');
  });
});

describe('listConnected', () => {
  it('connected 상태의 연결만 반환한다', () => {
    const pending = startConnection(newProject(), user.id);
    const done = startConnection(newProject(), user.id);
    completeConnection(done.state, workspace);

    const ids = listConnected().map((c) => c.id);
    expect(ids).toContain(done.connectionId);
    expect(ids).not.toContain(pending.connectionId);
  });
});
