import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGeminiEmbedder, RateLimitError } from '@/embedder';

const OK_BODY = (count: number, dim = 3) => ({
  embeddings: Array.from({ length: count }, (_, i) =>
    ({ values: Array.from({ length: dim }, () => i) })
  ),
});

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function makeEmbedder(fetchMock: typeof fetch) {
  return createGeminiEmbedder({
    apiKey: 'test-key',
    fetchImpl: fetchMock,
    retryDelayMs: 0,
    rateLimitDelayMs: 0,
  });
}

describe('createGeminiEmbedder', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('API 키가 없으면 생성 시점에 실패한다', () => {
    expect(() => createGeminiEmbedder({ apiKey: '' })).toThrow(/GEMINI_API_KEY/);
  });

  it('설정된 차원을 노출한다', () => {
    const embedder = makeEmbedder(vi.fn());
    expect(embedder.dimension).toBe(768);
  });

  it('gemini batchEmbedContents 형식으로 요청한다', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, OK_BODY(2)));
    const embedder = makeEmbedder(fetchMock as unknown as typeof fetch);

    await embedder.embed(['안녕', '하세요']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('gemini-embedding-001:batchEmbedContents');
    expect(init.headers['x-goog-api-key']).toBe('test-key');

    const body = JSON.parse(init.body);
    expect(body.requests).toHaveLength(2);
    expect(body.requests[0]).toMatchObject({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text: '안녕' }] },
      outputDimensionality: 768,
    });
  });

  it('응답의 embeddings.values를 순서대로 반환한다', async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      jsonResponse(200, { embeddings: [{ values: [1, 2, 3] }, { values: [4, 5, 6] }] })
    );
    const embedder = makeEmbedder(fetchMock as unknown as typeof fetch);

    await expect(embedder.embed(['a', 'b'])).resolves.toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('batchSize를 넘는 입력은 여러 요청으로 나눈다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, OK_BODY(100)))
      .mockResolvedValueOnce(jsonResponse(200, OK_BODY(1)));
    const embedder = makeEmbedder(fetchMock as unknown as typeof fetch);

    const vectors = await embedder.embed(Array.from({ length: 101 }, (_, i) => `t${i}`));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vectors).toHaveLength(101);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).requests).toHaveLength(100);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).requests).toHaveLength(1);
  });

  it('일시적 5xx는 재시도 후 성공한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: 'unavailable' }))
      .mockResolvedValueOnce(jsonResponse(200, OK_BODY(1)));
    const embedder = makeEmbedder(fetchMock as unknown as typeof fetch);

    await expect(embedder.embed(['a'])).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('재시도를 모두 소진하면 일반 오류를 던진다', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(500, { error: 'boom' }));
    const embedder = makeEmbedder(fetchMock as unknown as typeof fetch);

    await expect(embedder.embed(['a'])).rejects.toThrow(/Gemini 임베딩 호출 실패/);
    await expect(embedder.embed(['a'])).rejects.not.toBeInstanceOf(RateLimitError);
  });

  it('429는 RateLimitError로 구분해 던진다', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(429, { error: 'quota' }));
    const embedder = makeEmbedder(fetchMock as unknown as typeof fetch);

    await expect(embedder.embed(['a'])).rejects.toBeInstanceOf(RateLimitError);
  });

  it('429는 일반 오류보다 긴 대기 시간을 사용한다', async () => {
    const waits: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      waits.push(ms);
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: 'quota' }))
      .mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }))
      .mockResolvedValueOnce(jsonResponse(200, OK_BODY(1)));

    const embedder = createGeminiEmbedder({
      apiKey: 'test-key',
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryDelayMs: 100,
      rateLimitDelayMs: 5000,
      sleep,
    });

    await embedder.embed(['a']);

    expect(waits[0]).toBe(5000);
    expect(waits[1]).toBeLessThan(5000);
  });

  it('429 응답의 retry-after 헤더를 대기 시간으로 존중한다', async () => {
    const waits: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      waits.push(ms);
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: 'quota' }, { 'retry-after': '7' }))
      .mockResolvedValueOnce(jsonResponse(200, OK_BODY(1)));

    const embedder = createGeminiEmbedder({
      apiKey: 'test-key',
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryDelayMs: 100,
      rateLimitDelayMs: 5000,
      sleep,
    });

    await embedder.embed(['a']);

    expect(waits[0]).toBe(7000);
  });

  it('네트워크 오류는 원인을 담은 메시지로 감싼다', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const embedder = makeEmbedder(fetchMock as unknown as typeof fetch);

    await expect(embedder.embed(['a'])).rejects.toThrow(/Gemini API에 연결할 수 없습니다/);
  });

  it('요청 수와 응답 임베딩 수가 다르면 오류를 던진다', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, OK_BODY(1)));
    const embedder = makeEmbedder(fetchMock as unknown as typeof fetch);

    await expect(embedder.embed(['a', 'b'])).rejects.toThrow(/임베딩 개수/);
  });
});
