import { anthropic } from '@ai-sdk/anthropic';
import { generateText, streamText } from 'ai';
import { config } from '@/core/config';
import type { Message } from '@/core/types';

interface CompleteParams {
  system: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
}

const model = anthropic(config.generation.model);

export const llm = {
  async complete(params: CompleteParams): Promise<{ text: string }> {
    const { text } = await generateText({
      model,
      system: params.system,
      messages: params.messages,
      maxOutputTokens: params.maxTokens ?? config.generation.maxTokens,
      temperature: params.temperature ?? config.generation.temperature,
    });
    return { text };
  },

  stream(params: CompleteParams) {
    return streamText({
      model,
      system: params.system,
      messages: params.messages,
      maxOutputTokens: params.maxTokens ?? config.generation.maxTokens,
      temperature: params.temperature ?? config.generation.temperature,
    });
  },
};
