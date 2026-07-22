import { encodingForModel } from 'js-tiktoken';

const encoding = encodingForModel('gpt-4');

export function countTokens(text: string): number {
  return encoding.encode(text).length;
}
