import { config } from '@/config';
import { embedder } from '@/embedder';
import type { Retriever } from '@minutes/core';
import { createVectorStore } from './vectorStore';
import { keywordSearch } from './keywordSearch';
import { fuseResults } from './hybridSearch';
import { rerank } from './reranker';

/** 연결(사용자)별로 스코프된 Retriever — 해당 사용자의 문서만 검색한다. */
export function createRetriever(connectionId: string): Retriever {
  const vectorStore = createVectorStore(connectionId);

  return {
    async retrieve(query, options = {}) {
      const topK = options.topK ?? config.retrieval.topK;
      const useHybrid = options.useHybrid ?? true;

      const [queryVector] = await embedder.embed([query]);
      // 병합 과정에서 순위가 바뀌므로 각 검색은 topK * 2로 넉넉히 가져온다
      const vectorResults = await vectorStore.search(queryVector, topK * 2);

      if (!useHybrid) return vectorResults.slice(0, topK);

      const keywordResults = await keywordSearch(connectionId, query, topK * 2);
      let fused = fuseResults(vectorResults, keywordResults);

      if (options.useReranker ?? config.retrieval.useReranker) {
        fused = await rerank(query, fused, config.retrieval.rerankTopN);
      }

      return fused.slice(0, topK);
    },
  };
}
