#!/usr/bin/env bash
# minutes 서버 — .env 값을 대화식으로 입력받아 파일을 만들어 주는 스크립트.
# nano 편집 없이, 물어보는 값만 붙여넣으면 됩니다.
#
# VM에서 실행:
#   bash ~/minutes/deploy/oracle-env-setup.sh
# 끝나면 다시:
#   bash ~/minutes/deploy/oracle-vm-setup.sh
set -euo pipefail

ENV_FILE="$HOME/minutes/apps/server/.env"

ask() {
  # $1: 프롬프트 문구, $2: 변수명
  local prompt="$1" varname="$2" val=""
  while [ -z "$val" ]; do
    read -r -p "$prompt: " val
    [ -z "$val" ] && echo "  (빈 값은 안 됩니다. 다시 입력하세요)"
  done
  printf -v "$varname" '%s' "$val"
}

echo "=== minutes .env 만들기 ==="
echo "각 값을 붙여넣고 Enter를 누르세요."
echo

ask "1) NOTION_OAUTH_CLIENT_ID (색인용 앱 client id)" NOTION_ID
ask "2) NOTION_OAUTH_CLIENT_SECRET (색인용 앱 secret)" NOTION_SECRET

echo
echo "3~4) 로그인용 앱 값 — 따로 없으면 그냥 Enter만 누르면 위 색인용 값과 같게 씁니다."
read -r -p "3) NOTION_OAUTH_LOGIN_CLIENT_ID (없으면 Enter): " LOGIN_ID
read -r -p "4) NOTION_OAUTH_LOGIN_CLIENT_SECRET (없으면 Enter): " LOGIN_SECRET
LOGIN_ID="${LOGIN_ID:-$NOTION_ID}"
LOGIN_SECRET="${LOGIN_SECRET:-$NOTION_SECRET}"

echo
ask "5) GEMINI_API_KEY (https://aistudio.google.com/apikey)" GEMINI_KEY

# 노션 토큰 암호화 키 — 자동 생성 (32바이트 base64)
ENCRYPTION_KEY="$(openssl rand -base64 32)"

cat > "$ENV_FILE" <<EOF
# oracle-env-setup.sh 로 생성됨. 콜백 URI는 SSH 터널 방식 기본값.
NOTION_OAUTH_CLIENT_ID=$NOTION_ID
NOTION_OAUTH_CLIENT_SECRET=$NOTION_SECRET
NOTION_OAUTH_REDIRECT_URI=http://localhost:8787/oauth/notion/callback
NOTION_OAUTH_LOGIN_CLIENT_ID=$LOGIN_ID
NOTION_OAUTH_LOGIN_CLIENT_SECRET=$LOGIN_SECRET
NOTION_OAUTH_LOGIN_REDIRECT_URI=http://localhost:8787/auth/notion/callback
GEMINI_API_KEY=$GEMINI_KEY
MINUTES_ENCRYPTION_KEY=$ENCRYPTION_KEY
SQLITE_PATH=./data/minutes.db
PORT=8787
EOF
chmod 600 "$ENV_FILE"

echo
echo "=== 완료: $ENV_FILE 작성됨 (다른 사람이 못 읽게 권한 600) ==="
echo "이제 다음을 실행하세요:"
echo "  bash ~/minutes/deploy/oracle-vm-setup.sh"
