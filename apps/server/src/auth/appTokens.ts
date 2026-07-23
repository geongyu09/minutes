import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/db';
import { USER_COLUMNS, toUser, type User, type UserRow } from './users';

/** 앱 토큰은 서버에 sha256 해시로만 저장한다 — 평문 저장 금지. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 로그인 성공 시 발급하는 앱 토큰. 이후 모든 요청의 Bearer 인증에 쓰인다. */
export function issueAppToken(userId: string): string {
  const token = randomBytes(32).toString('base64url');
  db()
    .prepare('INSERT INTO app_tokens (token_hash, user_id) VALUES (?, ?)')
    .run(hashToken(token), userId);
  return token;
}

/** Bearer 앱 토큰으로 요청 사용자를 찾는다. */
export function findUserByAppToken(appToken: string): User | null {
  const row = db()
    .prepare(
      `SELECT ${USER_COLUMNS.split(', ').map((c) => `u.${c}`).join(', ')}
       FROM app_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ?`
    )
    .get(hashToken(appToken)) as UserRow | undefined;
  return row ? toUser(row) : null;
}

/** 로그아웃 — 해시 행을 지운다. 없는 토큰이어도 오류가 아니다(멱등). */
export function revokeAppToken(appToken: string): void {
  db().prepare('DELETE FROM app_tokens WHERE token_hash = ?').run(hashToken(appToken));
}
