#!/usr/bin/env bash
# Bootstrap чистого Ubuntu 22.04 VPS под Academ.voice.
# Использование (на свежем VPS, под root):
#   curl -fsSL https://raw.githubusercontent.com/n1kas1/AcademVoice/main/deploy/bootstrap.sh | bash
# либо после git clone — `bash deploy/bootstrap.sh`.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/n1kas1/AcademVoice.git}"
APP_DIR="${APP_DIR:-/opt/academ-voice}"

echo "==> apt update"
apt-get update -y
apt-get install -y curl git ufw

echo "==> install docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> firewall"
ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw --force enable || true

echo "==> clone repo to $APP_DIR"
if [ ! -d "$APP_DIR" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  cd "$APP_DIR" && git pull --ff-only
fi

cd "$APP_DIR/deploy"

if [ ! -f .env ]; then
  echo
  echo "==> .env не найден. Создаю из .env.example."
  echo "    Открой /opt/academ-voice/deploy/.env, заполни значения и"
  echo "    запусти:   docker compose up -d --build"
  cp .env.example .env
  exit 0
fi

echo "==> docker compose up -d --build"
docker compose pull || true
docker compose up -d --build

echo
echo "==> Готово. Проверь логи:"
echo "   docker compose -f $APP_DIR/deploy/docker-compose.yml logs -f api"
