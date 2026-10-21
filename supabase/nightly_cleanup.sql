-- Run AFTER migrations/001_online_game.sql, as the project administrator.
-- Supabase: Integrations > Cron > enable pg_cron, or enable it below.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Midnight India time = 18:30 UTC. This assumes the Cron timezone is GMT/UTC.
-- Check the returned setting before scheduling. If you changed the timezone,
-- use the dashboard's timezone-aware schedule instead.
SELECT current_setting('cron.timezone', true) AS cron_timezone;

DO $$
DECLARE
  v_timezone text := current_setting('cron.timezone', true);
BEGIN
  IF v_timezone IS NOT NULL AND v_timezone NOT IN ('GMT', 'UTC', 'Etc/UTC') THEN
    RAISE EXCEPTION 'Cron timezone is %. Set a midnight India-time schedule in the dashboard.', v_timezone;
  END IF;
END;
$$;

-- Re-running with the same name updates this job instead of adding a duplicate.
SELECT cron.schedule(
  'dealz-nightly-cleanup',
  '30 18 * * *',
  $$SELECT public.dealz_cleanup_rooms();$$
);

COMMIT;
