import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'eval/**/*.test.ts'],
    env: {
      // 테스트는 인메모리 DB를 사용한다 (파일 DB 오염 방지)
      SQLITE_PATH: ':memory:',
      // embedder는 키가 없으면 모듈 로드 시점에 실패한다(기동 실패). 테스트에서는 더미 키를 준다.
      GEMINI_API_KEY: 'test-key',
    },
  },
  resolve: {
    alias: {
      '@minutes/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
