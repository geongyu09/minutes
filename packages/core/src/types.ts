/** 노션에서 갓 추출한 문서 */
export interface RawDocument {
  id: string;                 // 노션 페이지 ID
  title: string;
  url: string;                // 노션 원문 링크
  markdown: string;
  lastEditedTime: string;     // ISO 8601
  parentTitle?: string;       // 상위 페이지/DB 제목
}

/** 청킹된 조각 */
export interface Chunk {
  id: string;                 // `${documentId}:${chunkIndex}`
  documentId: string;
  chunkIndex: number;
  content: string;
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  documentTitle: string;
  documentUrl: string;
  headingPath: string[];      // ["2주차 회의", "결정사항"]
  lastEditedTime: string;
  tokenCount: number;
}

export interface EmbeddedChunk extends Chunk {
  vector: number[];
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
  source: 'vector' | 'keyword' | 'hybrid';
}

export interface PromptContext {
  systemPrompt: string;
  userMessage: string;
  sources: SearchResult[];    // 인용 번호 매핑용
}

export interface Citation {
  number: number;
  documentTitle: string;
  documentUrl: string;
  headingPath: string[];
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/* ---------- 인터페이스 ---------- */

export interface DocumentSource {
  fetchAll(): Promise<RawDocument[]>;
  fetchUpdatedSince(date: Date): Promise<RawDocument[]>;
}

export interface Embedder {
  readonly dimension: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface VectorStore {
  upsert(chunks: EmbeddedChunk[]): Promise<void>;
  search(vector: number[], topK: number, filter?: SearchFilter): Promise<SearchResult[]>;
  deleteByDocumentId(documentId: string): Promise<void>;
  count(): Promise<number>;
}

export interface SearchFilter {
  documentIds?: string[];
  editedAfter?: Date;
}

export interface Retriever {
  retrieve(query: string, options?: RetrieveOptions): Promise<SearchResult[]>;
}

export interface RetrieveOptions {
  topK?: number;
  useHybrid?: boolean;
  useReranker?: boolean;
}

/** 생성 LLM 경계 — 로컬 CLI 어댑터를 이 뒤에 격리한다 */
export interface LlmClient {
  readonly provider: 'claude' | 'codex' | 'gemini';
  /** 프롬프트를 받아 답변 텍스트를 토큰 단위로 스트리밍한다 */
  stream(context: PromptContext): AsyncIterable<string>;
  /** CLI 설치·로그인 여부 확인 (온보딩 안내용) */
  isAvailable(): Promise<boolean>;
}
