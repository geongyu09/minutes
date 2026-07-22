# @minutes/server — 중앙 서버 (색인 + 검색)

노션 회의록을 색인하고 `POST /search`로 검색 결과를 제공하는 상시 프로세스.
Docker로 VM에 배포한다. 데스크탑 앱과의 경계는 HTTP API 하나다.

## HTTP API

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/search` | `{ query: string, topK?: number }` → top-k 청크 + 출처 |
| `GET` | `/status` | 문서·청크 수, 마지막 동기화 시각 |
| `GET` | `/health` | DB·임베딩 API 연결 확인. 정상 200 / 이상 503 |
| `POST` | `/index?mode=full\|incremental` | 수동 색인 트리거 |
| `POST` | `/oauth/notion/session` | 연결 세션 생성 → `{ appToken, authUrl }` 반환 |
| `GET` | `/oauth/notion/callback` | OAuth 콜백 — 토큰 교환 후 연결 저장 |
| `GET` | `/oauth/notion/status` | 앱 토큰의 연결 상태 확인 (`Authorization: Bearer <appToken>`) |

## 배포 절차 (Docker Compose)

모노레포 루트에서 실행한다. 임베딩은 Gemini API를 쓰므로 사이드카가 없다(12단계).

```bash
# 1. 환경 변수 준비 — 노션 OAuth 앱 정보와 Gemini API 키를 넣는다
cp apps/server/.env.example apps/server/.env
# NOTION_OAUTH_CLIENT_ID, NOTION_OAUTH_CLIENT_SECRET, NOTION_OAUTH_REDIRECT_URI,
# GEMINI_API_KEY(https://aistudio.google.com/apikey) 편집 — 키가 없으면 서버가 기동되지 않는다

# 2. 빌드 + 기동 (기동 시 db 마이그레이션 자동 적용)
docker compose up -d --build

# 3. 헬스 체크
curl http://localhost:8787/health
# {"status":"ok","db":"ok","embedding":"ok"}

# 4. 노션 워크스페이스 연결
#    데스크탑 앱이 자동으로 처리한다. 수동으로 할 때는 세션을 만들어 authUrl을 연다.
curl -s -X POST http://localhost:8787/oauth/notion/session
# → {"appToken":"...","authUrl":"https://api.notion.com/v1/oauth/authorize?..."}
# authUrl을 브라우저에서 열고 색인할 페이지를 선택하면 연결 완료.
# appToken은 이후 /index·/search·/status 호출 시 Authorization 헤더에 쓴다.

# 5. 최초 전체 색인
curl -X POST 'http://localhost:8787/index?mode=full' \
  -H 'authorization: Bearer <appToken>'

# 6. 검색 확인
curl -X POST http://localhost:8787/search \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <appToken>' \
  -d '{"query":"휴가 정책"}'
```

- SQLite 파일은 `minutes-data` 볼륨(`/app/apps/server/data`)에 영속된다.
- 색인 이후에는 서버 내 타이머가 10분 주기로 증분 동기화한다.
- 인증은 없다(비목표). **서버는 사내망/VPN 안에서만 연다 — 공개 인터넷 노출 금지.**

### 기존 로컬 DB를 가져가려면 (선택)

이미 로컬에서 색인한 `data/minutes.db`가 있으면 최초 색인 대신 볼륨에 복사할 수 있다.

```bash
docker compose up -d --build
docker compose cp apps/server/data/minutes.db server:/app/apps/server/data/minutes.db
docker compose restart server
```

## 데스크탑 앱 연결

앱은 `MINUTES_SERVER_URL`로 서버를 바라본다 (`apps/desktop/.env.local`):

```bash
MINUTES_SERVER_URL=http://<서버 주소>:8787
```

## 로컬 개발 (Docker 없이)

```bash
bun install
bun run db:migrate
bun run index:all      # 노션 워크스페이스 연결과 GEMINI_API_KEY 선행
bun run dev            # http://localhost:8787
```
