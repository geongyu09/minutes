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
    model: 'text-embedding-3-small',
    dimension: 1536,
    batchSize: 100,
  },
  retrieval: {
    topK: 8,
    vectorWeight: 0.7,
    keywordWeight: 0.3,
    rrfK: 60,
    useReranker: false,          // MVP에서는 끄고 시작
    rerankTopN: 4,
  },
  generation: {
    model: 'claude-sonnet-4-6',
    maxTokens: 2000,
    temperature: 0.1,            // 문서 기반 답변이므로 낮게
    historyTurns: 4,
  },
} as const;
