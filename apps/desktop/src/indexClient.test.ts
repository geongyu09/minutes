import { describe, expect, it } from 'vitest';
import { createIndexClient } from './indexClient';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const runningJob = { status: 'running', mode: 'full', indexed: 1, total: 5 };

describe('createIndexClient', () => {
  it('startReindex는 mode를 쿼리로 담아 POST /index를 호출한다', async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const client = createIndexClient(
      'http://server:8787',
      async (url, init) => {
        captured = { url: String(url), init };
        return jsonResponse({ job: runningJob }, 202);
      },
      () => null,
      () => 'p-1'
    );

    const job = await client.startReindex('full');

    expect(captured?.url).toBe('http://server:8787/index?projectId=p-1&mode=full');
    expect(captured?.init?.method).toBe('POST');
    expect(job.status).toBe('running');
  });

  it('이미 실행 중(409)이면 오류 대신 현재 잡 상태를 반환한다', async () => {
    const client = createIndexClient(
      'http://server:8787',
      async () => jsonResponse({ job: runningJob }, 409),
      () => null,
      () => 'p-1'
    );

    const job = await client.startReindex('incremental');

    expect(job.status).toBe('running');
  });

  it('getIndexJob은 GET /index/status를 호출한다', async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const client = createIndexClient(
      'http://server:8787',
      async (url, init) => {
        captured = { url: String(url), init };
        return jsonResponse({
        job: {
          status: 'done',
          result: {
            mode: 'incremental',
            total: 1,
            indexed: 0,
            failed: 0,
            deleted: 0,
            aborted: { reason: 'rate_limit', message: '쿼터 초과' },
          },
          finishedAt: '2026-07-22T00:00:00.000Z',
        },
        });
      },
      () => null,
      () => 'p-1'
    );

    const job = await client.getIndexJob();

    expect(captured?.url).toBe('http://server:8787/index/status?projectId=p-1');
    expect(captured?.init?.method ?? 'GET').toBe('GET');
    expect(job.status === 'done' && job.result.aborted?.reason).toBe('rate_limit');
  });

  it('앱 토큰이 있으면 Bearer 헤더로 보낸다', async () => {
    let captured: { init?: RequestInit } | undefined;
    const client = createIndexClient(
      'http://server:8787',
      async (_url, init) => {
        captured = { init };
        return jsonResponse({ job: { status: 'idle' } });
      },
      () => 'app-token',
      () => 'p-1'
    );

    await client.getIndexJob();

    expect((captured?.init?.headers as Record<string, string>).authorization).toBe('Bearer app-token');
  });

  it('서버가 오류를 반환하면 예외를 던진다', async () => {
    const client = createIndexClient(
      'http://server:8787',
      async () => jsonResponse({ error: '실패' }, 500),
      () => null,
      () => 'p-1'
    );

    await expect(client.startReindex('incremental')).rejects.toThrow(/색인 서버/);
    await expect(client.getIndexJob()).rejects.toThrow(/색인 서버/);
  });

  it('선택된 프로젝트가 없으면 서버를 부르지 않는다', async () => {
    let called = false;
    const client = createIndexClient(
      'http://server:8787',
      async () => {
        called = true;
        return jsonResponse({ job: { status: 'idle' } });
      },
      () => 'app-token',
      () => null
    );

    await expect(client.getIndexJob()).rejects.toThrow(/프로젝트/);
    expect(called).toBe(false);
  });
});
