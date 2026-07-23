import { startServer } from '@/api/server';
import { assertEncryptionKey } from '@/crypto';
import { startIncrementalSync } from '@/ingestion/scheduler';

// 키가 없으면 여기서 기동 실패 — 기본값으로 조용히 평문 저장에 빠지지 않게 한다 (storage.md)
assertEncryptionKey();
startServer();
startIncrementalSync();
