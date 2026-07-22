import { mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface TraceLog {
  requestId: string;
  timestamp: string;
  originalQuery: string;
  rewrittenQuery: string;
  retrievedChunks: { id: string; score: number; preview: string }[];
  promptTokens: number;
  answer: string;
  citedSources: number[];
  latencyMs: { retrieval: number; generation: number; total: number };
}

const TRACE_DIR = path.join(process.cwd(), 'logs', 'traces');

export function startTrace(originalQuery: string): TraceLog {
  return {
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
    originalQuery,
    rewrittenQuery: originalQuery,
    retrievedChunks: [],
    promptTokens: 0,
    answer: '',
    citedSources: [],
    latencyMs: { retrieval: 0, generation: 0, total: 0 },
  };
}

/** 트레이스를 logs/traces/{date}.jsonl에 한 줄로 추가한다. */
export function saveTrace(trace: TraceLog): void {
  mkdirSync(TRACE_DIR, { recursive: true });
  const date = trace.timestamp.slice(0, 10);
  appendFileSync(path.join(TRACE_DIR, `${date}.jsonl`), JSON.stringify(trace) + '\n');
}
