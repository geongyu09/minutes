export const config = {
  server: {
    baseUrl: process.env.MINUTES_SERVER_URL ?? 'http://localhost:8787',
  },
  generation: {
    cli: (process.env.LLM_CLI ?? 'auto') as 'claude' | 'codex' | 'gemini' | 'auto',
    timeoutMs: 120_000,          // CLI는 API보다 느리므로 여유 있게
    historyTurns: 4,
  },
} as const;
