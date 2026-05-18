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
