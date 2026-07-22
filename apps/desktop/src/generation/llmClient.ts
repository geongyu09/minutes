/**
 * LlmClient 구현체 — 사용자 로컬에 설치된 코딩 CLI(claude/codex/gemini)를 실행한다.
 * CLI 출력 형식은 버전에 따라 바뀔 수 있으므로 파싱 로직을 이 파일 안에 격리한다.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { config } from '@/config';
import type { LlmClient, PromptContext } from '@minutes/core';

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

async function checkAvailable(provider: Provider): Promise<boolean> {
  try {
    const child = spawn(provider, ['--version'], { stdio: 'ignore', timeout: 10_000 });
    const [code] = (await once(child, 'close')) as [number | null];
    return code === 0;
  } catch {
    return false;
  }
}

export function createLlmClient(provider: Provider): LlmClient {
  return {
    provider,

    async *stream(context: PromptContext): AsyncIterable<string> {
      const prompt = renderPrompt(context);
      const child = spawn(provider, cliArgs(provider, prompt), {
        timeout: config.generation.timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.stdout.setEncoding('utf8');

      if (provider === 'claude') {
        const parse = createStreamJsonParser();
        let buffer = '';
        for await (const chunk of child.stdout) {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const text = parse(line);
            if (text) yield text;
          }
        }
        if (buffer.trim()) {
          const text = parse(buffer);
          if (text) yield text;
        }
      } else {
        // codex/gemini는 stdout을 그대로 통과시킨다 (형식 변경 시 이 어댑터만 수정)
        for await (const chunk of child.stdout) {
          yield chunk as string;
        }
      }

      const [code] = (await once(child, 'close')) as [number | null];
      if (code !== 0) {
        throw new Error(
          `${provider} CLI가 비정상 종료했습니다 (code ${code}). ` +
            `터미널에서 '${provider} --version'과 로그인 상태를 확인하세요.\n${stderr.trim()}`
        );
      }
    },

    isAvailable(): Promise<boolean> {
      return checkAvailable(provider);
    },
  };
}

let cached: LlmClient | undefined;

/** 설정된 CLI를 쓰되, auto면 설치된 CLI를 순서대로 감지한다. */
export async function getLlmClient(): Promise<LlmClient> {
  if (cached) return cached;

  if (config.generation.cli !== 'auto') {
    cached = createLlmClient(config.generation.cli);
    return cached;
  }

  for (const provider of DETECT_ORDER) {
    if (await checkAvailable(provider)) {
      cached = createLlmClient(provider);
      return cached;
    }
  }

  throw new Error(
    `사용 가능한 LLM CLI를 찾지 못했습니다 (${DETECT_ORDER.join(', ')}). ` +
      `하나를 설치·로그인한 뒤 다시 시도하세요. LLM_CLI 환경 변수로 지정할 수도 있습니다.`
  );
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
