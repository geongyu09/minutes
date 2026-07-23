-- 15단계(색인 최적화) 5단계 — 내용이 그대로인 문서는 임베딩을 건너뛴다.
-- 해시에는 본문뿐 아니라 임베딩 모델·차원·청킹 파라미터가 섞여 있다
-- (ingestion/contentHash.ts). 파라미터가 바뀌면 해시가 달라져 자동으로 재임베딩된다.
-- NULL은 "아직 모른다" — 다음 색인에서 반드시 다시 임베딩한다.
ALTER TABLE documents ADD COLUMN content_hash TEXT;
