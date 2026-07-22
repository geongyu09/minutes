export interface EvalCase {
  query: string;
  expectedDocumentIds: string[];
  expectedKeywords: string[]; // 답변에 포함되어야 할 단어
  note?: string;
}

/**
 * 실제 노션 문서를 색인한 뒤, 문서에서 뽑은 질문 10~20개를 채워 넣는다.
 * expectedDocumentIds는 노션 페이지 ID (documents 테이블의 id).
 * 청킹 크기·top-k를 바꿀 때마다 이 세트로 수치 비교한다.
 */
export const evalSet: EvalCase[] = [
  // 예시 — 실제 데이터 색인 후 교체할 것:
  // {
  //   query: '로그인 방식은 뭘로 정했지?',
  //   expectedDocumentIds: ['page-abc'],
  //   expectedKeywords: ['소셜 로그인', '카카오'],
  // },
];
