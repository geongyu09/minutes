/**
 * 로컬 CLI 프로세스 실행 추상화.
 * Tauri shell 플러그인 의존을 이 파일에 격리해, llmClient의 파싱·조립 로직을
 * 순수하게 유지하고 fake runner로 단위 테스트할 수 있게 한다.
 */
import { Command } from '@tauri-apps/plugin-shell';

export interface CliExecution {
  /** stdout을 줄 단위로 내놓는다 (개행 제거됨) */
  lines: AsyncIterable<string>;
  wait(): Promise<{ code: number | null; stderr: string }>;
  kill(): void;
}

export interface CliRunner {
  run(program: string, args: string[]): Promise<CliExecution>;
  isInstalled(program: string): Promise<boolean>;
}

export interface LineQueue {
  push(line: string): void;
  close(): void;
  fail(error: unknown): void;
  lines: AsyncIterable<string>;
}

/** 이벤트 기반 stdout을 AsyncIterable로 바꾸는 큐. */
export function createLineQueue(): LineQueue {
  const buffer: string[] = [];
  let done = false;
  let failure: unknown;
  let wake: (() => void) | undefined;

  const notify = () => {
    wake?.();
    wake = undefined;
  };

  return {
    push(line) {
      if (done) return;
      buffer.push(line);
      notify();
    },
    close() {
      done = true;
      notify();
    },
    fail(error) {
      failure = error;
      done = true;
      notify();
    },
    lines: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          if (buffer.length > 0) {
            yield buffer.shift()!;
            continue;
          }
          if (failure !== undefined) throw failure;
          if (done) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      },
    },
  };
}

/**
 * Tauri shell 플러그인 기반 구현.
 * 실행 가능한 프로그램은 src-tauri/capabilities의 shell 스코프에 등록돼 있어야 한다.
 */
export function createTauriCliRunner(): CliRunner {
  return {
    async run(program, args) {
      const command = Command.create(program, args);
      const queue = createLineQueue();
      let stderr = '';

      let resolveClose: (code: number | null) => void;
      const closed = new Promise<number | null>((resolve) => {
        resolveClose = resolve;
      });

      command.stdout.on('data', (line: string) => queue.push(line));
      command.stderr.on('data', (line: string) => {
        stderr += `${line}\n`;
      });
      command.on('close', (payload: { code: number | null }) => {
        queue.close();
        resolveClose(payload.code);
      });
      command.on('error', (error: string) => {
        queue.fail(new Error(error));
        resolveClose(null);
      });

      const child = await command.spawn();

      return {
        lines: queue.lines,
        wait: async () => ({ code: await closed, stderr: stderr.trim() }),
        kill: () => {
          void child.kill();
        },
      };
    },

    async isInstalled(program) {
      try {
        const output = await Command.create(program, ['--version']).execute();
        return output.code === 0;
      } catch {
        return false;
      }
    },
  };
}
