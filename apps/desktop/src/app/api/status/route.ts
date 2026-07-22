import { logger } from '@minutes/core';
import { config } from '@/config';

export const dynamic = 'force-dynamic';

/** 중앙 서버 /status 프록시 — UI의 색인 상태 표시가 호출한다. */
export async function GET() {
  try {
    const res = await fetch(`${config.server.baseUrl}/status`, { cache: 'no-store' });
    return Response.json(await res.json(), { status: res.status });
  } catch (err) {
    logger.error('상태 조회 실패', String(err));
    return Response.json({ error: '검색 서버에 연결할 수 없습니다' }, { status: 502 });
  }
}
