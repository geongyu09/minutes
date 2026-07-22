import postgres from 'postgres';

let instance: postgres.Sql | undefined;

// 빌드 시점에는 DATABASE_URL이 없을 수 있으므로 첫 사용 시점에 연결한다
function client(): postgres.Sql {
  if (!instance) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL이 설정되지 않았습니다');
    }
    instance = postgres(databaseUrl, { max: 5, onnotice: () => {} });
  }
  return instance;
}

export const sql: postgres.Sql = new Proxy((() => {}) as unknown as postgres.Sql, {
  apply(_target, _thisArg, args) {
    return (client() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, prop) {
    const value = (client() as unknown as Record<PropertyKey, unknown>)[prop];
    return typeof value === 'function' ? (value as Function).bind(client()) : value;
  },
});
