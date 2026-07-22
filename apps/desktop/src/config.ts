// 정적 export(Tauri) 환경이므로 NEXT_PUBLIC_ 환경 변수는 빌드 시점에 인라인된다.
export const config = {
  server: {
    baseUrl: process.env.NEXT_PUBLIC_MINUTES_SERVER_URL ?? 'http://localhost:8787',
  },
  indexing: {
    pollIntervalMs: 2_000,       // 색인 잡 진행률 폴링 주기
  },
  generation: {
    cli: (process.env.NEXT_PUBLIC_LLM_CLI ?? 'auto') as 'claude' | 'codex' | 'gemini' | 'auto',
    timeoutMs: 120_000,          // CLI는 API보다 느리므로 여유 있게
    historyTurns: 4,
  },
} as const;
