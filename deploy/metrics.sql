-- AcademVoice — дашборд метрик (запускать в Supabase → SQL Editor).
-- Источник: таблица events (Retention Engine, Этап 0) + calls/reactions.
-- Типы событий: app_open, queue_join, match_success, call_complete, reaction, mutual_match, push_sent.

-- ── Общие счётчики ─────────────────────────────────────────────
select
  (select count(*) from users)                                              as users_total,
  (select count(*) from users where updated_at > now() - interval '24 hours') as active_24h,
  (select count(*) from calls)                                              as calls_total,
  (select count(*) from calls where started_at > now() - interval '24 hours') as calls_24h;

-- ── D1 / D7 возврат (по когортам первого app_open) ─────────────
-- Доля юзеров, у которых был app_open через 1 и через 7 дней после первого.
with firsts as (
  select tg_id, min(created_at)::date as d0
  from events
  where event_type = 'app_open' and tg_id is not null
  group by tg_id
),
ret as (
  select
    f.d0,
    f.tg_id,
    bool_or(e.created_at::date = f.d0 + 1) as d1,
    bool_or(e.created_at::date = f.d0 + 7) as d7
  from firsts f
  left join events e
    on e.tg_id = f.tg_id and e.event_type = 'app_open'
  group by f.d0, f.tg_id
)
select
  d0                                                   as cohort_date,
  count(*)                                             as cohort_size,
  round(100.0 * count(*) filter (where d1) / count(*), 1) as d1_return_pct,
  round(100.0 * count(*) filter (where d7) / count(*), 1) as d7_return_pct
from ret
group by d0
order by d0 desc;

-- ── Match-rate (успешные матчи / попытки встать в очередь) ──────
select
  date_trunc('day', created_at)::date as day,
  count(*) filter (where event_type = 'queue_join')    as joins,
  count(*) filter (where event_type = 'match_success') as matches,
  round(100.0 * count(*) filter (where event_type = 'match_success')
        / nullif(count(*) filter (where event_type = 'queue_join'), 0), 1) as match_rate_pct
from events
where event_type in ('queue_join', 'match_success')
group by 1
order by 1 desc;

-- ── Средняя длительность звонка (сек) ──────────────────────────
select
  date_trunc('day', created_at)::date as day,
  count(*)                                                  as completed_calls,
  round(avg((props->>'duration_secs')::numeric), 1)        as avg_duration_secs,
  round(percentile_cont(0.5) within group (
        order by (props->>'duration_secs')::numeric), 1)   as median_duration_secs
from events
where event_type = 'call_complete' and props->>'duration_secs' is not null
group by 1
order by 1 desc;

-- ── Mutual-rate (взаимные сердечки / звонки) ───────────────────
with mutual_rooms as (
  select room_name
  from reactions
  where reaction = 'like' and save_contact = true
  group by room_name
  having count(*) = 2
)
select
  (select count(*) from calls)            as calls_total,
  (select count(*) from mutual_rooms)     as mutual_total,
  round(100.0 * (select count(*) from mutual_rooms)
        / nullif((select count(*) from calls), 0), 1) as mutual_rate_pct;

-- ── Push-эффективность (после Этапов 1-2) ──────────────────────
-- CTR: доля push_sent, за которыми последовал app_open того же юзера в течение часа.
select
  count(*) filter (where event_type = 'push_sent')                    as pushes_sent,
  count(*) filter (where event_type = 'push_sent'
                   and props->>'kind' = 'mutual')                     as pushes_mutual
from events
where event_type = 'push_sent';
