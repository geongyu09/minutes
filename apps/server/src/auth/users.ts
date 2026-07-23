import { randomUUID } from 'node:crypto';
import { db } from '@/db';

/** 노션으로 로그인한 사용자. 노션 사용자 ID로 식별하고 첫 로그인 시 자동 생성된다. */
export interface User {
  id: string;
  notionUserId: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

/** 노션 인가 응답의 `owner.user`에서 뽑아낸 프로필. */
export interface NotionProfile {
  notionUserId: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

interface UserRow {
  id: string;
  notion_user_id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
}

const USER_COLUMNS = 'id, notion_user_id, email, name, avatar_url';

function toUser(row: UserRow): User {
  return {
    id: row.id,
    notionUserId: row.notion_user_id,
    email: row.email ?? undefined,
    name: row.name ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
  };
}

/** 노션 프로필로 계정을 만들거나(첫 로그인) 프로필을 갱신한다. */
export function upsertUser(profile: NotionProfile): User {
  const row = db()
    .prepare(
      `INSERT INTO users (id, notion_user_id, email, name, avatar_url)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(notion_user_id) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         avatar_url = excluded.avatar_url
       RETURNING ${USER_COLUMNS}`
    )
    .get(
      randomUUID(),
      profile.notionUserId,
      profile.email ?? null,
      profile.name ?? null,
      profile.avatarUrl ?? null
    ) as UserRow;
  return toUser(row);
}

export function findUserById(userId: string): User | null {
  const row = db()
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
    .get(userId) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export { USER_COLUMNS, toUser };
export type { UserRow };
