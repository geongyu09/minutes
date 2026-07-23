import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { applyMigrations } from '@/migrations';
import { upsertUser } from './users';
import { findUserByAppToken, issueAppToken, revokeAppToken } from './appTokens';

beforeAll(() => {
  applyMigrations(db());
});

describe('issueAppToken', () => {
  it('발급한 토큰으로 사용자를 찾는다', () => {
    const user = upsertUser({ notionUserId: 'at-1', name: '가영' });
    const token = issueAppToken(user.id);

    expect(findUserByAppToken(token)?.id).toBe(user.id);
  });

  it('앱 토큰을 평문으로 저장하지 않는다 (해시만 저장)', () => {
    const user = upsertUser({ notionUserId: 'at-2' });
    const token = issueAppToken(user.id);

    const rows = db().prepare('SELECT token_hash FROM app_tokens').all() as { token_hash: string }[];
    expect(rows.some((r) => r.token_hash === token)).toBe(false);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('findUserByAppToken', () => {
  it('모르는 토큰이면 null', () => {
    expect(findUserByAppToken('없는-토큰')).toBeNull();
  });
});

describe('revokeAppToken', () => {
  it('폐기한 토큰으로는 더 이상 사용자를 찾을 수 없다', () => {
    const user = upsertUser({ notionUserId: 'at-3' });
    const token = issueAppToken(user.id);

    revokeAppToken(token);

    expect(findUserByAppToken(token)).toBeNull();
  });

  it('없는 토큰을 폐기해도 오류가 아니다 (멱등)', () => {
    expect(() => revokeAppToken('없는-토큰')).not.toThrow();
  });
});
