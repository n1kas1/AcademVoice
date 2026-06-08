-- Запустить в Supabase → SQL Editor один раз.

create table if not exists users (
  tg_id        bigint primary key,
  username     text,
  first_name   text not null,
  faculty      text,
  course       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Юзер один раз согласился с правилами — больше Rules-экран ему не показываем.
alter table users add column if not exists rules_accepted_at timestamptz;

create table if not exists queue (
  tg_id        bigint primary key references users(tg_id) on delete cascade,
  joined_at    timestamptz not null default now()
);

create table if not exists calls (
  room_name    text primary key,
  a_tg_id      bigint not null references users(tg_id),
  b_tg_id      bigint not null references users(tg_id),
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);

create index if not exists calls_a_idx on calls(a_tg_id);
create index if not exists calls_b_idx on calls(b_tg_id);

create table if not exists reactions (
  room_name    text not null,
  from_tg_id   bigint not null,
  reaction     text not null check (reaction in ('like','dislike')),
  save_contact boolean not null default false,
  created_at   timestamptz not null default now(),
  primary key (room_name, from_tg_id)
);

create table if not exists reports (
  id           bigserial primary key,
  room_name    text not null,
  from_tg_id   bigint not null,
  reason       text not null,
  created_at   timestamptz not null default now()
);

-- === Аналитика (Retention Engine, Этап 0) ===
-- Лёгкий лог событий для воронки и retention. Намеренно БЕЗ FK на users,
-- чтобы логирование никогда не падало (например, app_open до upsert юзера).
create table if not exists events (
  id           bigserial primary key,
  tg_id        bigint,
  event_type   text not null,
  props        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists events_tg_created_idx on events(tg_id, created_at);
create index if not exists events_type_created_idx on events(event_type, created_at);

-- === Push-инфраструктура (Retention Engine, Этап 1) ===
-- Согласие на личные сообщения от бота (Telegram requestWriteAccess) + анти-спам метка.
alter table users add column if not exists allow_pm boolean not null default false;
alter table users add column if not exists last_pushed_at timestamptz;

-- Журнал отправленных push для идемпотентности (один (tg_id, dedup_key) — один раз).
create table if not exists push_log (
  tg_id       bigint not null,
  dedup_key   text not null,
  sent_at     timestamptz not null default now(),
  primary key (tg_id, dedup_key)
);
