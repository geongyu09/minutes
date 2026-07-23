import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { applyMigrations } from '@/migrations';
import {
  attachAppToken,
  claimAppToken,
  createLoginSession,
  hasLoginState,
} from './loginSessions';

beforeAll(() => {
  applyMigrations(db());
});

/**
 * 만료 시각을 과거로 돌려 "만료된 세션"을 만든다.
 * 각 테스트는 자기 세션만 쓰므로 전체를 만료시켜도 서로 간섭하지 않는다.
 */
function expireAll(): void {
  db().prepare("UPDATE login_sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
}

describe('createLoginSession', () => {
  it('폴링 토큰과 state를 발급한다', () => {
    const session = createLoginSession();

    expect(session.pollToken).toBeTruthy();
    expect(session.state).toBeTruthy();
    expect(hasLoginState(session.state)).toBe(true);
  });

  it('폴링 토큰을 평문으로 저장하지 않는다', () => {
    const session = createLoginSession();

    const rows = db()
      .prepare('SELECT poll_token_hash FROM login_sessions')
      .all() as { poll_token_hash: string }[];
    expect(rows.some((r) => r.poll_token_hash === session.pollToken)).toBe(false);
  });
});

describe('hasLoginState', () => {
  it('만료된 state는 없는 것으로 본다', () => {
    const session = createLoginSession();
    expireAll();

    expect(hasLoginState(session.state)).toBe(false);
  });

  it('모르는 state면 false', () => {
    expect(hasLoginState('없는-state')).toBe(false);
  });
});

describe('attachAppToken', () => {
  it('state로 세션을 찾아 앱 토큰을 준비해둔다', () => {
    const session = createLoginSession();

    expect(attachAppToken(session.state, 'app-token')).toBe(true);
    expect(claimAppToken(session.pollToken)).toBe('app-token');
  });

  it('만료된 세션에는 붙이지 않는다 (인가가 뒤늦게 돌아와도 무효)', () => {
    const session = createLoginSession();
    expireAll();

    expect(attachAppToken(session.state, 'app-token')).toBe(false);
  });

  it('state는 1회용 — 붙이고 나면 같은 state로 다시 붙일 수 없다', () => {
    const session = createLoginSession();
    attachAppToken(session.state, 'app-token');

    expect(attachAppToken(session.state, '다른-토큰')).toBe(false);
  });
});

describe('claimAppToken', () => {
  it('아직 인가가 끝나지 않았으면 null', () => {
    const session = createLoginSession();

    expect(claimAppToken(session.pollToken)).toBeNull();
  });

  it('앱 토큰은 일회 수령이다 — 수령 후 세션이 사라진다', () => {
    const session = createLoginSession();
    attachAppToken(session.state, 'app-token');

    expect(claimAppToken(session.pollToken)).toBe('app-token');
    expect(claimAppToken(session.pollToken)).toBeNull();
  });

  it('만료된 세션은 수령할 수 없다', () => {
    const session = createLoginSession();
    attachAppToken(session.state, 'app-token');
    expireAll();

    expect(claimAppToken(session.pollToken)).toBeNull();
  });
});
