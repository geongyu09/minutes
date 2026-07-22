# 모노레포 루트를 빌드 컨텍스트로 사용한다:
#   docker build -f apps/server/Dockerfile .
# 설치는 bun(workspace:* 프로토콜 지원), 런타임은 Node + tsx (로컬 개발과 동일).
# bun 런타임은 node-gyp로 빌드된 better-sqlite3를 로드하지 못한다(oven-sh/bun#4290).
# bun install이 better-sqlite3를 Node 24 헤더(ABI 137)로 빌드하므로 런타임도 Node 24를 쓴다.
FROM node:24-bookworm-slim

# bun은 의존성 설치에만 사용한다
COPY --from=oven/bun:1-debian /usr/local/bin/bun /usr/local/bin/bun

# better-sqlite3는 프리빌트 바이너리가 없는 Node ABI에서 node-gyp 소스 빌드로 폴백한다
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 의존성 레이어 캐시 — 매니페스트만 먼저 복사해 설치
# (데스크탑 워크스페이스는 배포 단위가 다르므로 제외하고 서버+코어만 설치)
COPY package.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
RUN bun install

# 소스 복사 (서버 + 공유 패키지만)
COPY tsconfig.json ./
COPY packages/core packages/core
COPY apps/server apps/server

WORKDIR /app/apps/server
EXPOSE 8787

# 기동 시 마이그레이션을 먼저 적용한 뒤 서버를 시작한다
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && exec npx tsx src/main.ts"]
