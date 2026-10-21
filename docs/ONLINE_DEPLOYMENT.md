# Deploy Dealz to Vercel + Supabase (no chat)

## 1. Finish database setup

You already ran `supabase/migrations/001_online_game.sql`. In Supabase SQL Editor, run **all of `supabase/migrations/002_cloud_runtime.sql`** next. It adds transactional create/join/restore, heartbeat snapshots and seat synchronization. Both migrations are required. Keep `private` outside the exposed API schemas.

In Authentication settings, enable **Anonymous Sign-Ins**. Players need only a nickname; their browser stores their guest session. A refresh restores their seat. Clearing browser data or switching browsers loses that identity.

Migration 001 adds only `rooms` metadata to the existing `supabase_realtime` publication. Never add `game_state` or `processed_commands` to Realtime. Opponents' hands and draw order must remain server-only.

## 2. Add the project to Vercel

Push this source folder to a private GitHub repository, including `api`, `server`, `shared`, `src`, `supabase`, `package.json`, `pnpm-lock.yaml`, `.env.online` and `vercel.json`. Do not upload `.data`, `.env.local`, other credential files, or `node_modules`.

In Vercel select **Add New → Project**, import the repository and choose its root directory. Use Node.js 22 or 24. The included `vercel.json` selects Vite, `npm run build:online`, and `dist-online` automatically. The API route is `/api/game`; it runs the shared authoritative rules engine in a Vercel Node function. This deployment does not run Socket.IO or require a persistent server.

## 3. Enter four environment variables

In the Supabase project, find the project URL and API keys. In Vercel → Project Settings → Environment Variables, add these for Production (and Preview if you use previews):

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL, e.g. `https://project.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key, or legacy anon key |
| `SUPABASE_URL` | Same project URL |
| `SUPABASE_SECRET_KEY` | Supabase secret key, or legacy service_role key |

Only the first two values are public browser configuration. **Never put the secret/service_role key in a variable starting `VITE_`.** Enter the secret directly into Vercel, not into a chat or source file. Changing variables requires a redeployment.

Click Deploy. Share the resulting HTTPS URL with friends. The QR code uses that same address; no shared Wi-Fi is needed online. Chat is absent in this mode.

## 4. Verify the live deployment

Open the HTTPS address in two separate browsers or devices (tabs in one browser share a guest identity). Create a room, join it using the code, mark both players ready and start. Verify each hand stays private, drag a legal property, reject an incompatible colour, finish a turn, refresh and restore the seat. To check pause handling, close the current player's browser for more than 75 seconds; an active player's next heartbeat should pause the table. Reopen the same browser, then have the owner resume.

Realtime room updates trigger personalized HTTPS fetches. A 15-second heartbeat also refreshes state as a fallback and detects disconnected seats after 75 seconds. This uses free-tier resources; cleanup does not remove service request, compute or bandwidth limits. Keep this initial deployment for your small friend group.

## 5. Nightly cleanup

Enable Supabase Cron and run `supabase/nightly_cleanup.sql` once. Its UTC schedule is 18:30 UTC, midnight India time. It deletes finished/abandoned rooms and rooms with no activity or member heartbeat for 24 hours. It preserves recently active games. Child game/member/command records cascade-delete. Supabase Auth guest identities are not deleted by this script.

## Local development

`./start.sh` still starts the Wi-Fi version with its local persistence and chat. The online output goes into `dist-online`, so it does not replace the local `dist` build.

For cloud development, copy `.env.example` to ignored `.env.local`, fill in your own values and run `npm run dev:online` (with Node.js 22+ and dependencies installed). This runs the Vite online client and the same API handler through the local development server. It still needs internet and the real Supabase project.

Validation performed locally: TypeScript, both Vite modes, 45 automated tests including real Socket.IO reconnect/restart tests, plus PostgreSQL 15 migration/runtime tests for create/join/restore, seats, duplicate/stale moves, nonmember denial and disconnect pausing. The online landing page and missing-configuration guidance were checked in a browser. Live Supabase Auth, Realtime and Vercel deployment still require your project settings and a live smoke test.

References: [Supabase Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous), [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js).
