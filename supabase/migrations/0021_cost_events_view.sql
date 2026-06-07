-- S-41: zunifikowany widok zdarzeń kosztowych per user.
-- Łączy vision_runs (status='succeeded') i refine_calls w jeden strumień
-- do sortowania, paginacji i filtrowania w GET /api/account/costs.
-- security_invoker = true: RLS tabel bazowych egzekwowany dla wywołującego
-- (user widzi tylko własne wiersze — polityki user_id = auth.uid() z 0015/0012).
-- Czysto addytywna (CREATE VIEW) — rollback = DROP VIEW cost_events.

create view public.cost_events
with (security_invoker = true) as
select
  vr.id,
  'vision'::text                          as kind,
  vr.user_id,
  vr.api_key_id,
  vr.model,
  vr.cost_usd,
  vr.latency_ms,
  vr.created_at,
  vr.photo_id,
  null::uuid                              as detection_id,
  null::text                              as raw_title
from public.vision_runs vr
where vr.status = 'succeeded'

union all

select
  rc.id,
  'refine'::text                          as kind,
  rc.user_id,
  rc.api_key_id,
  rc.model,
  rc.cost_usd,
  rc.latency_ms,
  rc.created_at,
  rc.photo_id,
  rc.detection_id,
  d.raw_title
from public.refine_calls rc
left join public.detections d on d.id = rc.detection_id;
