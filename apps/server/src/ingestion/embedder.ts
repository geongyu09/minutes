import { embedder } from '@/embedder';
import type { Chunk, EmbeddedChunk } from '@minutes/core';

export async function embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
  const vectors = await embedder.embed(chunks.map((c) => c.content));
  return chunks.map((chunk, i) => ({ ...chunk, vector: vectors[i] }));
}
