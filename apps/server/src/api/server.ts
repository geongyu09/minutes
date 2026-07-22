import http from 'node:http';
import { logger } from '@minutes/core';
import { config } from '@/config';
import { retriever } from '@/retrieval/retriever';
import { vectorStore, countDocuments } from '@/retrieval/vectorStore';
import { getLastSyncTime } from '@/ingestion/syncState';
import { runIndexing } from '@/ingestion/indexer';
import { db } from '@/db';
import { handleHealth, handleSearch } from './handlers';

async function checkDb(): Promise<void> {
  db().prepare('SELECT count(*) FROM chunks').get();
}

async function checkOllama(): Promise<void> {
  const res = await fetch(`${config.embedding.ollamaBaseUrl}/api/tags`);
  if (!res.ok) throw new Error(`Ollama 응답 오류 (${res.status})`);
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function respond(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    try {
      if (req.method === 'POST' && url.pathname === '/search') {
        const result = await handleSearch(await readJson(req), retriever);
        respond(res, result.status, result.body);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        const result = await handleHealth({ checkDb, checkOllama });
        respond(res, result.status, result.body);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/status') {
        respond(res, 200, {
          documentCount: await countDocuments(),
          chunkCount: await vectorStore.count(),
          lastSyncedAt: (await getLastSyncTime()).toISOString(),
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/index') {
        const mode = url.searchParams.get('mode') === 'full' ? 'full' : 'incremental';
        respond(res, 200, await runIndexing(mode));
        return;
      }
      respond(res, 404, { error: '알 수 없는 경로입니다' });
    } catch (err) {
      logger.error(`요청 처리 실패: ${req.method} ${url.pathname}`, String(err));
      respond(res, 500, { error: '요청 처리에 실패했습니다' });
    }
  });
}

export function startServer(): http.Server {
  const server = createServer();
  server.listen(config.server.port, () => {
    logger.info(`검색 서버 시작 — http://localhost:${config.server.port}`);
  });
  return server;
}
