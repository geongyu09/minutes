# 모노레포 루트를 빌드 컨텍스트로 사용한다:
#   docker build -f apps/server/Dockerfile .
# better-sqlite3, sqlite-vec 네이티브 모듈은 npm install 시 리눅스용 프리빌트 바이너리를 받는다.
FROM node:22-bookworm-slim

WORKDIR /app

# 의존성 레이어 캐시 — 매니페스트만 먼저 복사해 설치
COPY package.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
RUN npm install

# 소스 복사 (서버 + 공유 패키지만; 데스크탑은 배포 단위가 다르다)
COPY tsconfig.json ./
COPY packages/core packages/core
COPY apps/server apps/server

WORKDIR /app/apps/server
EXPOSE 8787

# 기동 시 마이그레이션을 먼저 적용한 뒤 서버를 시작한다
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && exec npx tsx src/main.ts"]
