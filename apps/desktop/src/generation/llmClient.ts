/**
 * LlmClient 구현체 — 사용자 로컬에 설치된 코딩 CLI(claude/codex/gemini)를 실행한다.
 * 프로세스 실행은 CliRunner(Tauri shell 플러그인)에 위임하고,
 * CLI 출력 파싱 로직은 이 파일 안에 격리한다.
 */
import { config } from '@/config';
import type { LlmClient, PromptContext } from '@minutes/core';
import { createTauriCliRunner, type CliRunner } from './cliRunner';

type Provider = LlmClient['provider'];

const DETECT_ORDER: Provider[] = ['claude', 'codex', 'gemini'];

/** CLI는 system/user 구분이 없으므로 하나의 프롬프트로 합친다. */
export function renderPrompt(context: PromptContext): string {
  return `${context.systemPrompt}\n\n${context.userMessage}`;
}

/**
 * claude stream-json 출력의 한 줄에서 텍스트 델타를 뽑는 파서.
 * 우선순위: 부분 델타 > assistant 전체 메시지 > result. 중복 출력을 막는다.
 */
export function createStreamJsonParser(): (line: string) => string {
  let emitted = false;

  return (line: string): string => {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return '';
    }

    if (event?.type === 'stream_event') {
      const delta = event.event?.delta;
      if (event.event?.type === 'content_block_delta' && delta?.type === 'text_delta') {
        emitted = true;
        return delta.text ?? '';
      }
      return '';
    }

    if (event?.type === 'assistant' && !emitted) {
      const text = (event.message?.content ?? [])
        .filter((part: any) => part?.type === 'text')
        .map((part: any) => part.text)
        .join('');
      if (text) emitted = true;
      return text;
    }

    if (event?.type === 'result' && !emitted && typeof event.result === 'string') {
      emitted = true;
      return event.result;
    }

    return '';
  };
}

function cliArgs(provider: Provider, prompt: string): string[] {
  switch (provider) {
    case 'claude':
      return ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose', prompt];
    case 'codex':
      return ['exec', prompt];
    case 'gemini':
      return ['-p', prompt];
  }
}

export function createLlmClient(provider: Provider, runner: CliRunner): LlmClient {
  return {
    provider,

    async *stream(context: PromptContext): AsyncIterable<string> {
      const prompt = renderPrompt(context);
      const execution = await runner.run(provider, cliArgs(provider, prompt));
      const timer = setTimeout(() => execution.kill(), config.generation.timeoutMs);

      try {
        if (provider === 'claude') {
          const parse = createStreamJsonParser();
          for await (const line of execution.lines) {
            const text = parse(line);
            if (text) yield text;
          }
        } else {
          // codex/gemini는 stdout을 그대로 통과시킨다 (형식 변경 시 이 어댑터만 수정)
          let first = true;
          for await (const line of execution.lines) {
            yield first ? line : `\n${line}`;
            first = false;
          }
        }

        const { code, stderr } = await execution.wait();
        if (code !== 0) {
          throw new Error(
            `${provider} CLI가 비정상 종료했습니다 (code ${code}). ` +
              `터미널에서 '${provider} --version'과 로그인 상태를 확인하세요.\n${stderr}`
          );
        }
      } finally {
        clearTimeout(timer);
      }
    },

    isAvailable(): Promise<boolean> {
      return runner.isInstalled(provider);
    },
  };
}

/** 설정이 auto일 때 설치된 CLI를 순서대로 감지한다. */
export async function detectProvider(runner: CliRunner): Promise<Provider> {
  for (const provider of DETECT_ORDER) {
    if (await runner.isInstalled(provider)) return provider;
  }
  throw new Error(
    `사용 가능한 LLM CLI를 찾지 못했습니다 (${DETECT_ORDER.join(', ')}). ` +
      `하나를 설치·로그인한 뒤 다시 시도하세요. NEXT_PUBLIC_LLM_CLI 환경 변수로 지정할 수도 있습니다.`
  );
}

let cached: LlmClient | undefined;

/** 설정된 CLI를 쓰되, auto면 설치된 CLI를 순서대로 감지한다. */
export async function getLlmClient(): Promise<LlmClient> {
  if (cached) return cached;

  const runner = createTauriCliRunner();
  const provider = config.generation.cli !== 'auto' ? config.generation.cli : await detectProvider(runner);
  cached = createLlmClient(provider, runner);
  return cached;
}

/** 스트림을 모아 전체 텍스트로 반환하는 편의 함수 (질의 재작성 등 비스트리밍 용도). */
export async function complete(context: PromptContext): Promise<string> {
  const client = await getLlmClient();
  let text = '';
  for await (const chunk of client.stream(context)) {
    text += chunk;
  }
  return text;
}
