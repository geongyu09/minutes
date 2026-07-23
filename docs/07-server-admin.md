# 서버 운영

팀을 위해 minutes 서버를 직접 띄우고 관리하는 분을 위한 문서입니다. 준비물부터 기동, 환경 변수, API, 자동 색인, 백업, 보안 주의사항까지 한 곳에 정리했습니다.

## 준비물

| 항목 | 설명 |
| --- | --- |
| 실행 환경 | **Node 24 + tsx**로 실행합니다. 의존성 설치는 bun을 사용합니다. |
| Gemini API 키 | 임베딩 생성에 필요합니다. <https://aistudio.google.com/apikey>에서 발급합니다. |
| 노션 Public Integration | OAuth 앱을 만들고 client id · secret · 리디렉션 URI를 확보합니다. |
| 포트 | 기본 `8787` |

> ⚠️ **bun 런타임으로 서버를 직접 실행하면 안 됩니다.** `better-sqlite3` 로드에 실패합니다. Docker 이미지가 `node:24-bookworm-slim` 기반인 이유도 이것입니다. bun은 의존성 설치와 스크립트 실행에만 쓰세요.

> ⚠️ **`GEMINI_API_KEY`가 비어 있으면 서버가 기동 즉시 종료됩니다** (`embedder.ts:141-144`). 오류 메시지에 키 발급 URL이 함께 출력됩니다.

## 데이터베이스는 SQLite 파일 하나입니다

별도의 DB 서버가 필요 없습니다. 모든 데이터는 **`apps/server/data/minutes.db`** 파일 하나에 들어갑니다. 벡터 검색은 `sqlite-vec`(vec0) 확장, 키워드 검색은 SQLite 내장 FTS5를 사용합니다.

## 환경 변수

`apps/server/.env.example`을 복사해 `apps/server/.env`를 만들고 값을 채웁니다.

| 이름 | 필수 | 기본값 | 의미 |
| --- | --- | --- | --- |
| `NOTION_OAUTH_CLIENT_ID` | 필수 | — | 노션 OAuth 앱 client id |
| `NOTION_OAUTH_CLIENT_SECRET` | 필수 | — | 노션 OAuth 앱 secret (Basic 인증에 사용) |
| `NOTION_OAUTH_REDIRECT_URI` | 필수 | — | **색인용 연결** 인가의 콜백 URL. **노션 앱 설정값과 정확히 일치**해야 합니다. 로컬 기본값은 `http://localhost:8787/oauth/notion/callback` |
| `NOTION_OAUTH_LOGIN_REDIRECT_URI` | 필수 | — | **"노션으로 로그인"** 인가의 콜백 URL. 위와 별개로 노션 앱 설정에 함께 등록해야 합니다. 로컬 기본값은 `http://localhost:8787/auth/notion/callback` |
| `GEMINI_API_KEY` | 필수 | `''` | 임베딩 API 키. 빈 값이면 기동 실패 |
| `MINUTES_ENCRYPTION_KEY` | 필수 | — | 노션 토큰 암호화 키(AES-256-GCM). 32바이트 base64 (`openssl rand -base64 32`). 빈 값이면 기동 실패. **키를 잃어버리면 모든 연결이 재인증 필요** |
| `SQLITE_PATH` | 선택 | `./data/minutes.db` | DB 파일 경로. `:memory:`도 지원 |
| `PORT` | 선택 | `8787` | HTTP 포트 |
| `OLLAMA_BASE_URL` | 미사용 | — | Ollama 롤백 대비 값. 현재 주석 처리되어 있습니다 |

## Docker Compose로 기동 (권장)

저장소 루트에서 진행합니다.

```bash
cp apps/server/.env.example apps/server/.env
# 위 표의 필수 값 4개를 편집합니다
docker compose up -d --build
curl http://localhost:8787/health
# {"status":"ok","db":"ok","embedding":"ok"}
```

컨테이너 CMD가 마이그레이션을 먼저 실행하므로 별도의 마이그레이션 단계는 필요 없습니다. 이후 앱에서 노션을 연결하고 `POST /index?mode=full`로 최초 전체 색인을 한 번 돌립니다.

데이터는 named volume `minutes-data`(`/app/apps/server/data`)에 영속됩니다.

> ⚠️ `env_file`이 `required: false`로 되어 있어 `.env`가 없어도 컨테이너 자체는 뜹니다. 하지만 `GEMINI_API_KEY`가 없으면 프로세스가 곧바로 죽습니다. `.env`를 반드시 만들어 주세요.

기존 로컬 DB를 컨테이너로 옮기려면:

```bash
docker compose cp apps/server/data/minutes.db server:/app/apps/server/data/minutes.db
docker compose restart server
```

## 로컬에서 직접 실행

```bash
bun install
bun run db:migrate
bun run index:all
bun run dev
```

> ⚠️ 마이그레이션은 `process.cwd()` 기준으로 마이그레이션 디렉터리를 찾습니다(`migrations.ts:20`). 반드시 **`apps/server` 디렉터리에서** 실행하세요.

> ⚠️ 앱 기동 시 마이그레이션이 자동 실행되지 않습니다. 자동 실행은 Docker의 CMD가 대신 처리하는 것뿐입니다. 로컬 실행에서는 직접 `db:migrate`를 돌려야 합니다.

## 운영 스크립트

저장소 루트에서 실행할 수 있습니다.

| 명령 | 용도 |
| --- | --- |
| `bun run server:dev` | 서버 개발 모드 실행 |
| `bun run db:migrate` | 마이그레이션 적용 |
| `bun run index:all` | 연결된 모든 사용자 전체 색인 |
| `bun run index:incremental` | 증분 색인 1회 실행 |
| `bun run search "질문" [--topK 8] [--no-hybrid]` | 검색 결과 단건 확인 (첫 번째 연결 기준) |
| `bun run eval [--topK 8] [--no-hybrid]` | Recall@k 측정. 평균 0.8 미만이면 실패 종료 |
| `bun run test` / `bun run typecheck` | 테스트 / 타입 검사 |

## HTTP API

인증은 `Authorization: Bearer {appToken}` 헤더로 합니다. 앱 토큰은 서버에 sha256 해시 형태로만 저장됩니다.

| 메서드 | 경로 | 인증 | 요청 | 성공 응답 | 에러 |
| --- | --- | --- | --- | --- | --- |
| POST | `/oauth/notion/session` | 불필요 | — | `{appToken, authUrl}` | — |
| GET | `/oauth/notion/callback` | 불필요 | query `code`, `state`, `error` | HTML 안내 페이지 | 400 HTML |
| GET | `/oauth/notion/status` | Bearer | — | `{connected}` 또는 `{connected, workspaceName}` | 401 |
| POST | `/search` | Bearer + 연결완료 | `{query, topK?: 1~50}` | `{results, tookMs}` | 400 / 401 / 403 |
| GET | `/health` | 불필요 | — | `{status, db, embedding}` | 503 (각 필드에 원인 문자열) |
| GET | `/status` | Bearer + 연결완료 | — | `{documentCount, chunkCount, lastSyncedAt, workspaceName}` | 401 / 403 |
| POST | `/index?mode=full\|incremental` | Bearer + 연결완료 | `mode` 미지정 시 `incremental` | `{mode, total, indexed, failed, deleted}` | 401 / 403 |
| — | 그 외 경로 | — | — | — | 404 |

401은 앱 토큰이 없거나 무효한 경우, 403은 연결이 아직 `pending` 상태인 경우입니다.

> ⚠️ `/oauth/notion/session`은 **인증이 필요 없는 공개 엔드포인트**입니다. 이 서비스는 공개 인터넷 노출을 전제로 하므로, 무인증 엔드포인트는 호출자·경로별 레이트 리밋(분당 60회)으로 보호됩니다. 공개 시에는 반드시 HTTPS 리버스 프록시(Caddy) 뒤에서만 노출하세요 — 아래 "보안 주의사항" 참고.

## 자동 색인 스케줄러

- 서버 기동과 함께 **10분 주기**로 증분 색인이 돕니다. 매 회차마다 `connected` 상태의 **모든 연결을 순차 처리**합니다.
- 증분 기준은 연결별 마지막 동기화 시각보다 `last_edited_time`이 큰 페이지입니다. 첫 실행 시에는 사실상 전체 색인이 됩니다.
- 동기화 시각은 색인 **시작 시각**으로 기록합니다. 색인 진행 중 수정된 페이지가 누락되지 않게 하기 위함입니다.
- 노션 search 결과에 없는데 DB에는 남아 있는 문서는 매 회차 삭제됩니다.
- 문서 단위·연결 단위 실패는 건너뛰고 나머지를 계속 진행합니다.
- 노션 토큰이 401로 만료되면 refresh token으로 1회 갱신한 뒤 재시도합니다.
- 노션 API 호출은 초당 3회로 스로틀되며, 429·5xx에는 지수 백오프(최대 30초, 5회)로 대응합니다.

> ⚠️ 연결을 **순차 처리**하므로, 한 팀의 색인이 길어지면 뒤에 있는 팀의 색인이 그만큼 밀립니다.

## DB 스키마

| 테이블 | 역할 |
| --- | --- |
| `schema_migrations` | 적용된 마이그레이션 이력 |
| `notion_connections` | 연결 1건 = 워크스페이스 1개. `app_token_hash`(sha256, unique), `oauth_state`(1회용), `status`(pending/connected), `access_token`/`refresh_token`, `workspace_id`/`name`/`icon` |
| `documents` | 노션 페이지 메타데이터. PK `(connection_id, id)` |
| `chunks` | 조각 본문. PK `(connection_id, id)`, id는 `{documentId}:{chunkIndex}` 형식. `heading_path`는 JSON. `documents`에 CASCADE |
| `chunks_vec` | sqlite-vec vec0 가상 테이블. `float[768]`, cosine |
| `chunks_fts` | FTS5(unicode61) 키워드 인덱스 |
| `sync_state` | key/value 저장소. `last_synced_at:{connectionId}` |

> ⚠️ 002 마이그레이션은 001이 만든 `documents` · `chunks` · `chunks_vec` · `chunks_fts`를 **DROP 후 재생성**합니다. 기존 색인 데이터가 사라지므로 적용 후 전체 재색인이 필요합니다.

> ⚠️ `config.embedding.dimension`(768)과 마이그레이션의 `float[768]`이 **반드시 일치**해야 합니다. 임베딩 차원을 바꾸면 마이그레이션도 함께 고쳐야 합니다.

## 운영 중 문제 대응

| 증상 | 원인 | 해결 |
| --- | --- | --- |
| 서버가 기동하자마자 죽음 | `GEMINI_API_KEY` 또는 `MINUTES_ENCRYPTION_KEY` 미설정 | `.env`에 키를 넣습니다. 에러 메시지에 원인이 출력됩니다. |
| 로그에 `토큰 복호화 실패로 연결을 pending 처리`가 대량 발생 | `MINUTES_ENCRYPTION_KEY`가 기존 데이터를 암호화한 키와 다름(배포 실수) 또는 DB 변조 | 키를 원래 값으로 되돌리면 복구됩니다. 키를 잃었다면 각 프로젝트에서 노션 재연결이 필요합니다. |
| `/health`가 503 | 응답 body의 `db` / `embedding` 필드에 원인 문자열이 담깁니다 | `Gemini 임베딩 API 응답 오류 (4xx)`라면 API 키 또는 쿼터 문제입니다. |
| OAuth 콜백이 400 | `state` 만료(진행 중 연결은 1시간 TTL로 정리) 또는 리디렉션 URI 불일치 | 노션 앱 설정의 리디렉션 URI와 `NOTION_OAUTH_REDIRECT_URI`가 정확히 같은지 확인합니다. |
| 색인 결과가 0건 | 로그에 `연결된 노션 워크스페이스가 없습니다`가 찍혔거나, 노션에서 페이지를 공유하지 않았습니다 | 연결 상태와 노션 페이지 공유 범위를 확인합니다. |
| 색인이 느리고 중간에 멈춘 듯함 | Gemini 429(쿼터 초과) | 60초 대기 후 최대 3회 재시도합니다. 무료 티어 일일 한도에 걸리면 색인이 지연됩니다. |

### 로그 보기

로그는 stdout/stderr에 JSON 한 줄(`{level, time, message, extra}`) 형식으로 나갑니다.

```bash
docker compose logs -f server
```

색인 진행 상황은 `[n/total] 제목 — 청크 N개` 형식으로 출력됩니다.

> ⚠️ `src/trace.ts`(요청 트레이스 기록)는 파일로 존재하지만 **어디에서도 호출되지 않는 미배선 코드**입니다. 트레이스 파일은 생성되지 않으니 디버깅 근거로 삼지 마세요.

### 백업

DB가 WAL 모드로 동작하므로 `minutes.db` 단독이 아니라 **`minutes.db` + `minutes.db-wal` + `minutes.db-shm` 세트를 함께** 보관해야 합니다. Docker로 운영 중이라면 `minutes-data` 볼륨 전체를 백업하면 됩니다.

## 보안 주의사항

노션 액세스 토큰은 **AES-256-GCM으로 암호화되어** DB에 저장됩니다. 암호화 키(`MINUTES_ENCRYPTION_KEY`)는 `.env`에만 두고 DB와 같은 곳에 백업하지 마세요 — 키와 DB가 함께 유출되면 암호화가 무의미해집니다. 복호화에 실패한 연결(키 교체·변조)은 자동으로 `pending`으로 전환되어 재연결을 유도합니다.

> ⚠️ **여러 팀의 회의록이 하나의 SQLite 파일에 함께 저장됩니다.** 팀 간 격리는 모든 쿼리에 붙는 `connection_id` 조건만으로 이뤄집니다. 설계 문서가 요구하는 연결별 DB 파일 분리는 아직 미구현입니다.

> ⚠️ **공개 인터넷 노출 시 규칙** — 이 서비스는 불특정 다수 대상 공개 운영을 전제로 합니다. 노출은 반드시 HTTPS 리버스 프록시(Caddy 자동 TLS) 뒤에서만 하고, 서버 포트(8787)는 호스트에 직접 열지 마세요. 무인증 엔드포인트(`/oauth/notion/session` 등)는 레이트 리밋으로 보호되지만, HTTP 평문 노출은 앱 토큰·노션 토큰이 전송 구간에서 그대로 노출되므로 금지입니다. 구체적 절차는 `.claude/skills/public-deploy/SKILL.md`를 따르세요.

## 다음 문서

- [전체 목차](README.md)
- [시작하기](01-getting-started.md)
- [노션 워크스페이스 연결](02-notion-connect.md)
- [질문과 답변](03-asking-questions.md)
- [색인과 최신화](04-indexing.md)
- [동작 원리](05-how-it-works.md)
- [문제 해결](06-troubleshooting.md)
- [한계와 개인정보](08-limits-and-privacy.md)
