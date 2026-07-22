export const config = {
  notion: {
    // OAuth(Public Integration) — 2026-07-22 확정. 사용자별 액세스 토큰은 DB에 저장.
    oauthClientId: process.env.NOTION_OAUTH_CLIENT_ID!,
    oauthClientSecret: process.env.NOTION_OAUTH_CLIENT_SECRET!,
    oauthRedirectUri: process.env.NOTION_OAUTH_REDIRECT_URI!,
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
    // 12단계 — 한시적으로 Gemini API를 쓴다. 서버 자원에 여유가 생기면 Ollama로 되돌린다.
    model: 'gemini-embedding-001',
    dimension: 768,              // 변경 시 db/migrations의 vec0 차원도 함께 변경
    batchSize: 100,              // batchEmbedContents 요청당 상한
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    retryDelayMs: 1000,          // 일반 오류 재시도 기준 대기(지수 백오프)
    rateLimitDelayMs: 60_000,    // 429는 즉시 재시도해도 다시 걸리므로 따로 대기
    maxRetries: 3,

    // Ollama 복귀용 설정 (12단계 롤백 시 되살린다)
    // model: 'nomic-embed-text',   // Recall 미달 시 'bge-m3'
    // ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
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
