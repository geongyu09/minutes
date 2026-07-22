import { runIndexing } from '@/ingestion/indexer';
import { logger } from '@/core/logger';

export const maxDuration = 300;

/** 색인 트리거. cron 호출은 CRON_SECRET Bearer 토큰으로 보호한다. */
export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return Response.json({ error: '인증에 실패했습니다' }, { status: 401 });
    }
  }

  const mode = new URL(req.url).searchParams.get('mode') === 'full' ? 'full' : 'incremental';

  try {
    const result = await runIndexing(mode);
    return Response.json(result);
  } catch (err) {
    logger.error('색인 실행 실패', String(err));
    return Response.json({ error: '색인 실행에 실패했습니다' }, { status: 500 });
  }
}

export const GET = POST; // Vercel Cron은 GET으로 호출
