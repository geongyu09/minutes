export const config = {
  notion: {
    apiKey: process.env.NOTION_API_KEY!,
    rootPageIds: (process.env.NOTION_ROOT_PAGE_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    requestsPerSecond: 3,        // 노션 rate limit
    maxRetries: 5,
  },
  chunking: {
    targetTokens: 600,
    maxTokens: 900,
    overlapRatio: 0.12,
    minTokens: 50,               // 이보다 작으면 앞 청크에 병합
  },
  embedding: {
    model: 'nomic-embed-text',   // Ollama 로컬 모델. Recall 미달 시 'bge-m3'
    dimension: 768,              // 변경 시 db/migrations의 vec0 차원도 함께 변경
    batchSize: 100,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  },
  storage: {
    sqlitePath: process.env.SQLITE_PATH ?? './data/minutes.db',
  },
  retrieval: {
    topK: 8,
    vectorWeight: 0.7,
    keywordWeight: 0.3,
    rrfK: 60,
    useReranker: false,          // MVP에서는 끄고 시작
    rerankTopN: 4,
  },
  sync: {
    intervalMs: 10 * 60_000,     // 증분 동기화 주기 (서버 내 타이머)
  },
  server: {
    port: Number(process.env.PORT ?? 8787),
  },
} as const;
