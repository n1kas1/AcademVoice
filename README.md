# Академ.voice

Голосовая чатрулетка для студентов ВШЭ.
Telegram Mini App: @AcademVoice_bot

## Стек
- Frontend: Vite + React + TS + Tailwind + Telegram WebApp SDK + livekit-client (`/web`)
- Backend: FastAPI + Supabase (Python) + LiveKit Server SDK (`/api`)
- Realtime: Supabase Realtime для очереди матчинга
- Голос: LiveKit Cloud
- Hosting: Vercel (web) + Railway (api)

## Структура

```
academ-voice/
  web/         # Telegram Mini App (фронт)
  api/         # FastAPI бэк
  README.md
```

## Запуск локально

### Web
```
cd web
npm install
npm run dev
```

### API
```
cd api
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Environment

### web/.env
```
VITE_API_URL=https://academ-voice-api.up.railway.app
```

### api/.env
```
TELEGRAM_BOT_TOKEN=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_WS_URL=...
```

## Команда
- Я — frontend
- Ярослав + друг — backend

## Дедлайн MVP: 06:00
