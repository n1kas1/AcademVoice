FROM python:3.12-slim

# Avoid .pyc, no buffering
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

WORKDIR /app

# OS deps (нужны для asyncpg на slim — обычно нет, но gcc на всякий случай)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY migrations.sql ./migrations.sql

EXPOSE 8000

# ВАЖНО: ровно 1 воркер. Матчинг сериализуется in-memory asyncio.Lock
# (app/main.py: _match_lock) — несколько воркеров = независимые локи = гонки/дубль-матчи.
# Горизонтальное масштабирование потребует Postgres advisory lock.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
