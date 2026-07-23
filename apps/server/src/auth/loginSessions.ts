import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db } from '@/db';

/** 로그인 인가는 짧게 끝나는 흐름이다 — 오래 열린 state를 남기지 않는다. */
const SESSION_TTL = '+10 minutes';

export interface LoginSession {
  /** 앱이 앱 토큰을 수령할 때까지 폴링에 쓰는 임시 토큰 (해시로만 저장). */
  pollToken: string;
  /** 노션 인가 URL에 실어 보내는 state. */
  state: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const NOT_EXPIRED = "expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** 로그인 시작 — 폴링 토큰과 state를 발급한다. 만료된 세션은 이때 함께 정리한다. */
export function createLoginSession(): LoginSession {
  db().prepare(`DELETE FROM login_sessions WHERE NOT (${NOT_EXPIRED})`).run();

  const pollToken = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  db()
    .prepare(
      `INSERT INTO login_sessions (id, poll_token_hash, oauth_state, expires_at)
       VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?))`
    )
    .run(randomUUID(), hashToken(pollToken), state, SESSION_TTL);

  return { pollToken, state };
}

/** 노션 토큰 교환(외부 호출) 전에 살아 있는 state인지 먼저 거른다. */
export function hasLoginState(state: string): boolean {
  const row = db()
    .prepare(`SELECT 1 FROM login_sessions WHERE oauth_state = ? AND ${NOT_EXPIRED}`)
    .get(state);
  return row !== undefined;
}

/**
 * 인가 완료 — state의 세션에 앱 토큰을 준비해둔다. state는 1회용이므로 즉시 비운다.
 * 만료·이미 사용된 state면 false (뒤늦게 돌아온 콜백은 무효).
 */
export function attachAppToken(state: string, appToken: string): boolean {
  const result = db()
    .prepare(
      `UPDATE login_sessions SET app_token = ?, oauth_state = NULL
       WHERE oauth_state = ? AND ${NOT_EXPIRED}`
    )
    .run(appToken, state);
  return result.changes > 0;
}

/** 앱이 폴링으로 앱 토큰을 수령한다 — 일회성이므로 수령과 동시에 세션을 지운다. */
export function claimAppToken(pollToken: string): string | null {
  const row = db()
    .prepare(
      `DELETE FROM login_sessions
       WHERE poll_token_hash = ? AND app_token IS NOT NULL AND ${NOT_EXPIRED}
       RETURNING app_token`
    )
    .get(hashToken(pollToken)) as { app_token: string } | undefined;
  return row?.app_token ?? null;
}
