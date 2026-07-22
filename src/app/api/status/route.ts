import { vectorStore, countDocuments } from '@/retrieval/vectorStore';
import { getLastSyncTime } from '@/ingestion/syncState';
import { logger } from '@/core/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json({
      documentCount: await countDocuments(),
      chunkCount: await vectorStore.count(),
      lastSyncedAt: (await getLastSyncTime()).toISOString(),
    });
  } catch (err) {
    logger.error('상태 조회 실패', String(err));
    return Response.json({ error: '상태 조회에 실패했습니다' }, { status: 500 });
  }
}
