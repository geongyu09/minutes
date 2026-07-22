import { startServer } from '@/api/server';
import { startIncrementalSync } from '@/ingestion/scheduler';

startServer();
startIncrementalSync();
