# Деплой Academ.voice

Архитектура: **Kamatera VPS** (API + Caddy в Docker) + **Supabase** (только Postgres) + **Vercel** (фронт) + **LiveKit Cloud** (голос).

## 1. Supabase (БД)

1. supabase.com → Start project → Continue with GitHub
2. New project: имя `academ-voice`, пароль БД сгенерируй и **сохрани**, регион **Central EU (Frankfurt)**, тариф **Free**
3. Ждём ~2 мин
4. **SQL Editor** → New query → вставить содержимое `api/migrations.sql` → Run
5. **Project Settings → Database → Connection string → URI → Mode: Session** → копируй строку, замени `[YOUR-PASSWORD]` на пароль из шага 2

Это и есть `DATABASE_URL`.

> ⚠️ **Session pooler, не Transaction** — у Transaction pooler нет поддержки prepared statements, asyncpg будет ругаться.

## 2. LiveKit Cloud (голос)

1. cloud.livekit.io → Sign up with Google → Create new project `academ-voice`
2. Settings → Keys → Add new → копируй **API Key**, **API Secret**, **WS URL** (`wss://academ-voice-xxx.livekit.cloud`)

## 3. Kamatera VPS

В личном кабинете создаём сервер:
- **Datacenter**: ближайший (Frankfurt / Amsterdam — оба хорошо, у Kamatera в Москве нет)
- **OS**: Ubuntu Server 22.04 LTS, 64-bit
- **Image**: чистая
- **Server type**: A — General Purpose
- **CPU**: 1 vCPU
- **RAM**: 1024 MB
- **Disk**: SSD 20 GB
- **Public IP**: Yes
- **Password**: задаём руками или ставим Generate

После создания ждём ~5 мин, в `My Cloud → Servers` появятся **IP** и пароль.

## 4. Домен (нужен для HTTPS)

Быстрый вариант на ночь — **DuckDNS** (бесплатно):
1. duckdns.org → войти через Google/GitHub
2. Добавить subdomain: `academvoice` → получится `academvoice.duckdns.org`
3. В поле `current ip` вписать IP Kamatera VPS → Update

Готово, можно идти дальше.

## 5. Подключаемся и разворачиваем

```bash
ssh root@<IP_KAMATERA>
# пароль из письма

curl -fsSL https://raw.githubusercontent.com/n1kas1/AcademVoice/main/deploy/bootstrap.sh | bash
```

Скрипт:
- ставит Docker
- открывает фаервол (22, 80, 443)
- клонит репо в `/opt/academ-voice`
- создаёт пустой `.env`

Теперь заполняем `.env`:

```bash
nano /opt/academ-voice/deploy/.env
```

```
TELEGRAM_BOT_TOKEN=<новый_токен_после_revoke>
DATABASE_URL=postgresql://postgres.xxx:PASS@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
LIVEKIT_API_KEY=<из_livekit>
LIVEKIT_API_SECRET=<из_livekit>
LIVEKIT_WS_URL=wss://academ-voice-xxx.livekit.cloud
CORS_ORIGINS=https://academ-voice.vercel.app,http://localhost:5173
API_DOMAIN=academvoice.duckdns.org
```

`Ctrl+O`, Enter, `Ctrl+X`.

Запускаем:

```bash
cd /opt/academ-voice/deploy
docker compose up -d --build
```

Первый старт 2-3 мин (сборка образа + Caddy получает SSL-сертификат).

## 6. Проверка

```bash
curl https://academvoice.duckdns.org/
# → {"ok":true,"service":"academ.voice"}

curl https://academvoice.duckdns.org/health
# → {"ok":true}

docker compose logs -f api
```

Если `/health` отвечает `{"ok":true}` — БД подключена, всё живо.

## 7. Дальше — фронт

- В `web/.env`: `VITE_API_URL=https://academvoice.duckdns.org`
- Vercel → New Project → import репо → root directory `web` → Environment Variables → `VITE_API_URL=https://academvoice.duckdns.org` → Deploy
- @BotFather → AcademVoice_bot → Bot Settings → Menu Button → URL → `https://<твой-vercel-домен>`

## Обновление кода после push

```bash
cd /opt/academ-voice && git pull && cd deploy && docker compose up -d --build
```

## Бэкап БД

Supabase сам делает ежедневные snapshot на free-tier (7 дней хранения), смотри в Database → Backups. Дополнительно вручную:

```bash
pg_dump "$DATABASE_URL" > backup-$(date +%F).sql
```
