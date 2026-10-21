# Online database setup (without chat)

1. Open the dedicated Supabase game project, then SQL Editor > New query.
2. Paste all of `migrations/001_online_game.sql` and run it once as the project administrator. It creates the four tables, indexes, RLS policies, server-only atomic move function, cleanup function, and the safe room-metadata Realtime publication entry. Existing table-name conflicts abort the transaction rather than deleting data.
3. Keep the `private` schema outside the exposed API schemas. Keep the Supabase secret/service-role key exclusively in the backend.
4. Run `migrations/002_cloud_runtime.sql`, then enable Anonymous Sign-Ins in Authentication.
5. Enable Supabase Cron (Integrations > Cron). Paste and run `nightly_cleanup.sql`. It schedules completed/stale-room deletion at 18:30 UTC, midnight India time. The script refuses a non-UTC/GMT Cron configuration; adjust the schedule in the dashboard if needed.

The cloud client and Vercel API are implemented. Follow `docs/ONLINE_DEPLOYMENT.md` for the four Vercel environment variables, build settings, and live verification. The online build omits chat; `./start.sh` retains the local Wi-Fi game.

`game_state` and `processed_commands` have no browser privileges. Room metadata is readable by members; a membership row is readable only by its own guest. The API supplies the rest of the public roster. Never publish the complete game state through Realtime. The API must fetch personalized state on subscription, reconnect and room-version changes.

Cleanup removes finished/abandoned rooms and rooms whose room activity AND every member heartbeat are older than 24 hours. Children cascade-delete. The API maintains activity and heartbeat timestamps. It does not delete Supabase Auth users or any unrelated tables.

Validation: the base migration was executed against an isolated PostgreSQL 15 instance with Supabase Auth roles/functions represented by local test fixtures. Tests verified member isolation, private-state denial, server-only RPC/cleanup access, idempotency, stale-state rejection, simultaneous-command serialization, and cascade cleanup. The pg_cron schedule has not been executed against your Supabase project.
