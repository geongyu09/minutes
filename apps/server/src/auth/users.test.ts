import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { applyMigrations } from '@/migrations';
import { findUserById, upsertUser } from './users';

beforeAll(() => {
  applyMigrations(db());
});

describe('upsertUser', () => {
  it('첫 로그인이면 계정을 만든다 (별도 회원가입 없음)', () => {
    const user = upsertUser({ notionUserId: 'nu-1', email: 'a@example.com', name: '가영' });

    expect(user.id).toBeTruthy();
    expect(user.notionUserId).toBe('nu-1');
    expect(user.email).toBe('a@example.com');
    expect(findUserById(user.id)?.name).toBe('가영');
  });

  it('같은 노션 사용자면 계정을 새로 만들지 않고 프로필만 갱신한다', () => {
    const first = upsertUser({ notionUserId: 'nu-2', name: '이전 이름' });
    const second = upsertUser({ notionUserId: 'nu-2', name: '바뀐 이름', avatarUrl: 'https://x/y.png' });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe('바뀐 이름');
    expect(second.avatarUrl).toBe('https://x/y.png');
  });

  it('노션이 이메일을 주지 않아도 계정을 만든다', () => {
    const user = upsertUser({ notionUserId: 'nu-3' });

    expect(user.email).toBeUndefined();
  });
});

describe('findUserById', () => {
  it('없는 ID면 null', () => {
    expect(findUserById('없음')).toBeNull();
  });
});
