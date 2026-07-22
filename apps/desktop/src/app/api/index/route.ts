import { logger } from '@minutes/core';
import { config } from '@/config';

export const maxDuration = 300;

/** 중앙 서버 /index 프록시 — UI의 수동 재색인 버튼이 호출한다. */
export async function POST(req: Request) {
  const mode = new URL(req.url).searchParams.get('mode') === 'full' ? 'full' : 'incremental';

  try {
    const res = await fetch(`${config.server.baseUrl}/index?mode=${mode}`, { method: 'POST' });
    return Response.json(await res.json(), { status: res.status });
  } catch (err) {
    logger.error('색인 실행 실패', String(err));
    return Response.json({ error: '검색 서버에 연결할 수 없습니다' }, { status: 502 });
  }
}
