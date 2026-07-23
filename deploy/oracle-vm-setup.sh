#!/usr/bin/env bash
# minutes 서버 — Oracle Always Free VM(Ubuntu, ARM/AMD 공용) 1회 설치 스크립트.
#
# VM에 SSH로 접속한 뒤, 이 스크립트를 그대로 붙여넣어 실행하세요:
#   curl -fsSL https://raw.githubusercontent.com/geongyu09/minutes/feature/notion-oauth/deploy/oracle-vm-setup.sh | bash
# (또는 레포를 clone 했다면: bash deploy/oracle-vm-setup.sh)
#
# 이 스크립트는 포트를 외부에 열지 않습니다. 접속은 노트북에서 SSH 터널로만 합니다(README 참고).
set -euo pipefail

REPO_URL="https://github.com/geongyu09/minutes.git"
BRANCH="feature/notion-oauth"
APP_DIR="$HOME/minutes"

echo "==> 1/4 도커·git 설치"
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y docker.io docker-compose-v2 git
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER"
  echo "   도커를 새로 설치했습니다. 그룹 반영을 위해 이 스크립트가 sudo로 docker를 호출합니다."
  DOCKER="sudo docker"
else
  DOCKER="docker"
fi

echo "==> 2/4 코드 내려받기"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

echo "==> 3/4 환경 변수 파일 준비"
ENV_FILE="apps/server/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp apps/server/.env.example "$ENV_FILE"
  echo
  echo "   !!! 잠깐 멈춥니다 — 아래 파일을 열어 값 5개를 채운 뒤 이 스크립트를 다시 실행하세요:"
  echo "       nano $APP_DIR/$ENV_FILE"
  echo
  echo "   채울 값:"
  echo "     NOTION_OAUTH_CLIENT_ID / NOTION_OAUTH_CLIENT_SECRET"
  echo "     NOTION_OAUTH_LOGIN_CLIENT_ID / NOTION_OAUTH_LOGIN_CLIENT_SECRET (없으면 위 값과 동일하게)"
  echo "     GEMINI_API_KEY  (https://aistudio.google.com/apikey 에서 발급)"
  echo "   콜백 URI는 localhost 기본값 그대로 두세요 (SSH 터널 방식이라 바꿀 필요 없음)."
  exit 0
fi

echo "==> 4/4 빌드 & 기동 (몇 분 걸립니다)"
$DOCKER compose up -d --build

echo
echo "==> 완료. 상태 확인:"
sleep 3
$DOCKER compose logs --tail=20 server || true
echo
echo "서버가 VM 안에서 8787 포트로 떴습니다 (외부 비공개)."
echo "노트북에서 아래로 접속하세요 (deploy/README.md 참고):"
echo "  ssh -L 8787:localhost:8787 ubuntu@<VM_공인IP>"
echo "그 상태에서 브라우저/데스크톱 앱이 http://localhost:8787 로 서버에 닿습니다."
