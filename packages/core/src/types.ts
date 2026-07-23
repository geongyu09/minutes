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

/** 변경·삭제 감지에 필요한 최소 메타데이터 */
export interface DocumentRef {
  id: string;
  lastEditedTime: string;
}

export interface DocumentListing<R extends DocumentRef = DocumentRef> {
  refs: R[];
  /** 소스의 전체 목록인가. 조기 종료해 일부만 받았으면 false — 삭제 감지에 쓰면 안 된다. */
  complete: boolean;
}

export interface DocumentSource<R extends DocumentRef = DocumentRef> {
  /**
   * 문서 목록(메타데이터만). `since`를 주면 그보다 오래된 문서가 나온 시점에 조기 종료할 수 있고,
   * 그때 `complete`는 false다.
   */
  listRefs(options?: { since?: Date }): Promise<DocumentListing<R>>;
  /**
   * 목록을 **인자로 받아** 문서를 스트리밍한다 — 한 회차에 목록을 두 번 조회하지 않기 위함.
   * 스트리밍(AsyncIterable)인 이유: 한 건의 오류가 전체 수집을 죽이지 않게 문서 단위로 격리하고,
   * 전체 문서를 메모리에 올리지 않기 위함.
   */
  fetch(refs: R[], options?: unknown): AsyncIterable<RawDocument>;
}

export interface Embedder {
  readonly dimension: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface VectorStore {
  /** meta.contentHash를 함께 저장하면 다음 회차에 내용이 그대로인 문서의 임베딩을 건너뛸 수 있다 */
  upsert(chunks: EmbeddedChunk[], meta?: { contentHash?: string }): Promise<void>;
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
