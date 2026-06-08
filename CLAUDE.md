# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это

AcademVoice — голосовая чат-рулетка для студентов Академии (анонимные 1-на-1 голосовые звонки со случайным собеседником). Реализована как **Telegram Mini App**: фронт открывается внутри Telegram, авторизация — через Telegram WebApp `initData`. Telegram-бот: `@AcademVoice_bot`.

Монорепо из трёх частей:
- `web/` — фронт (Vite + React 18 + TypeScript + Tailwind + Zustand + `@twa-dev/sdk` + `livekit-client`)
- `api/` — бэк (FastAPI + asyncpg + LiveKit Server SDK)
- `deploy/` — продакшн-инфраструктура (Docker Compose + Caddy)

## Команды

### Frontend (`web/`)
```bash
npm install
npm run dev        # Vite dev-сервер на localhost:5173
npm run build      # tsc -b && vite build → web/dist
npm run preview    # предпросмотр собранного бандла
```
Линтера (ESLint) и тестов на фронте **нет**. Единственная проверка типов — `tsc -b` внутри `npm run build`.

### Backend (`api/`)
```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000   # требует .env с DATABASE_URL, TELEGRAM_BOT_TOKEN, LIVEKIT_*
```
Тестов **нет** (нет `tests/`, нет pytest-конфига). При добавлении — `httpx` + `TestClient`, мокать `tg_auth.extract_user_from_header` и пул asyncpg.
Быстрые проверки живого API: `curl localhost:8000/` (→ `{"ok":true,"service":"academ.voice"}`), `curl localhost:8000/health` (проверяет БД).

### Полный стек / деплой
```bash
# Локально весь стек (нужен deploy/.env со всеми секретами):
docker compose -f deploy/docker-compose.yml up -d --build

# Деплой на прод-VPS (см. раздел «Деплой» ниже):
./deploy.sh            # авто: определяет изменённые сервисы по git diff
./deploy.sh api        # только бэк
./deploy.sh web        # только фронт+Caddy (ВНИМАНИЕ: затрагивает и соседний проект academ4i)
./deploy.sh --no-build # только git pull на сервере, без пересборки
```

## Архитектура

### Рантайм (прод)
```
Telegram WebApp → HTTPS → Caddy (:80/:443, контейнер web)
   ├─ /me /match/* /call/* /health /stats  → reverse_proxy api:8000 (FastAPI)
   └─ /*                                    → статика Vite (/srv) с SPA-fallback на index.html
FastAPI (api:8000) → Supabase Postgres (единственное хранилище) + LiveKit Cloud (медиа)
```
Фронт и API живут за одним Caddy (**same-origin**): `web/src/lib/api.ts` берёт `BASE = VITE_API_URL ?? ""`, т.е. по умолчанию шлёт запросы относительным путём. `VITE_API_URL` нужен только если фронт хостится отдельно.

### Аутентификация
Каждый запрос несёт заголовок `Authorization: tma <telegram_initData>`. `api/app/tg_auth.py` валидирует HMAC-SHA256 подпись `initData` секретом из `TELEGRAM_BOT_TOKEN` и проверяет возраст `auth_date` (≤24ч), затем достаёт `user.id`. Зависимость `get_user` в `main.py` оборачивает это и кидает 401. Большинство эндпоинтов вызывают `upsert_user` — пользователь заводится при первом обращении.

### Матчинг — ключевые нюансы (читать `api/app/main.py`)
- Очередь — таблица `queue` в Postgres (FIFO по `joined_at`). Сериализация подбора — **in-memory `asyncio.Lock`** (`_match_lock`). Это работает **только в одном процессе**: при 2+ воркерах uvicorn или нескольких инстансах будут гонки. Горизонтальное масштабирование требует Postgres advisory lock.
- `POST /match/join`: проверяет активный звонок → берёт первого ждущего → создаёт `calls`-запись с `room_name` и выдаёт LiveKit-токены обоим; если очередь пуста — встаёт в неё.
- `GET /match/poll`: фронт опрашивает каждые **1.5с** (нет WebSocket/SSE). Каждый poll продлевает TTL записи и проверяет, не появился ли активный звонок.
- `QUEUE_TTL_SECONDS = 60`: «зомби» из очереди (закрытая вкладка) чистятся **лениво** — только когда приходит запрос на `/match/join`, `/match/poll` или `/stats`. Фонового воркера нет.
- **ВАЖНО: `faculty`/`course` НЕ участвуют в матчинге.** Подбор чисто FIFO (`select tg_id from queue where tg_id <> $1 order by joined_at limit 1`). Факультет/курс только собираются в профиле и показываются собеседнику. «Фильтр по факультету» как фича подбора — не реализован.
- Нет blacklist: тех же двоих может сматчить повторно сразу после `skip`.

### Голос (LiveKit)
`api/app/livekit_tokens.py` генерирует JWT (identity `u{tg_id}`, room `r_<hex>`, grants на publish/subscribe/data, **TTL 1 час** — рефреша нет). Клиент (`web/src/lib/livekit.ts`, экран `Call.tsx`) подключается к комнате, публикует микрофон, подписывается на аудио собеседника. Реконнекта при разрыве нет — `ParticipantDisconnected`/`Disconnected` ведут сразу на `AfterCall`.

### Фронт — машина состояний экранов
Навигация хранится в Zustand (`web/src/lib/store.ts`), роутинга-библиотеки нет — `App.tsx` рендерит экран по полю `screen`:
```
splash → rules → profile → home → (searching | call) → aftercall → home
```
`api.ts` — единственный слой обращений к бэку (тонкая обёртка над fetch). `faculties.ts` — захардкоженный список 8 факультетов и курсов.

### Механика «сердечко» / mutual
Во время звонка `apiLike` шлёт `POST /call/reaction` с `reaction:"like", save_contact:true`. Реакция **невидима собеседнику** (нет социального давления). Обмен `@username` происходит, только если **оба** поставили like с `save_contact`. Проверка взаимности — в момент реакции и повторно на `AfterCall` через `GET /call/{room_name}/result` (собеседник мог нажать сердечко уже после твоего ухода).

### Данные (`api/app/migrations.sql`)
Таблицы: `users` (tg_id PK, faculty, course, rules_accepted_at), `queue` (tg_id PK, joined_at), `calls` (room_name PK, a_tg_id, b_tg_id, started_at, ended_at), `reactions` (room_name+from_tg_id PK, reaction, save_contact), `reports`. Миграции применяются автоматически при старте API (`api/app/db.py`) — отдельного инструмента миграций (Alembic) нет, версионирования схемы нет.

## Конфигурация (env)

Реальные переменные (`api/app/config.py` + `deploy/.env.example`), а **не** то, что написано в `README.md`:
- `TELEGRAM_BOT_TOKEN` — токен бота (секрет подписи initData)
- `DATABASE_URL` — Postgres. На проде это Supabase, **обязательно Session pooler mode** (не Transaction — иначе asyncpg ломается на prepared statements)
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_WS_URL`
- `CORS_ORIGINS` — список разрешённых origin через запятую
- `API_DOMAIN` — домен для Caddy (без `https://`)
- web: `VITE_API_URL` — опционально; пусто = same-origin через Caddy

Секреты живут в `deploy/.env` (вне git). `.env` и `.DS_Store` в `.gitignore`.

## Деплой

Прод крутится на личном VPS в Docker Compose; деплой — через локальный `./deploy.sh` (push в GitHub → SSH на сервер → `git pull` → `docker compose up -d --build` нужного сервиса). Сам `deploy.sh` — в `.gitignore` (содержит адрес сервера). Деталей сервера здесь нет намеренно.

**Связь с соседним проектом academ4i:** контейнер `web` (Caddy) обслуживает и `academ4i.duckdns.org`, проксируя на `academ4i-backend` в docker-сети `academ4i_default` (объявлена external в `deploy/docker-compose.yml`). Пересборка `web` затрагивает оба проекта. `deploy.sh` имеет guard: не задеплоит, если сеть `academ4i_default` отсутствует.

## Важные предостережения

- **`README.md` сильно устарел** (писался в спешке на хакатоне, «Дедлайн MVP: 06:00»). Не верь ему: реальный хостинг — VPS + Docker + Caddy (не Railway/Vercel); realtime — HTTP-polling (не Supabase Realtime); БД — через `DATABASE_URL`/asyncpg (не `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`). Источник истины — код и `deploy/`.
- `deploy/Caddyfile` — **мёртвый файл, не используется**. В образ попадает `web/Caddyfile` (`web/Dockerfile`: `COPY Caddyfile`). Правки в `deploy/Caddyfile` ни на что не влияют — это ловушка.
- Матчинг не масштабируется горизонтально (`asyncio.Lock`); очистка очереди ленивая; LiveKit-токен живёт 1ч без рефреша — учитывать при изменениях в этих зонах.
- Нет rate-limiting, structured logging и мониторинга — ошибки в проде видны только через `docker compose logs`.
