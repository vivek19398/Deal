import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { apply, view } from "../shared/engine.js";
import { validateEnvelope } from "../shared/validate.js";
import type {
  OnlineRequest,
  OnlineResponse,
  OnlineSnapshot,
} from "../shared/online.js";
import type { Game, Session } from "../shared/model.js";
export class CloudError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "INVALID_REQUEST",
  ) {
    super(message);
  }
}
export interface CloudDatabase {
  enter(
    userId: string,
    input: Extract<OnlineRequest, { action: "enter" }>,
  ): Promise<Session>;
  snapshot(
    code: string,
    userId: string,
    touch: boolean,
  ): Promise<OnlineSnapshot | null>;
  processed(roomId: string, memberId: string, id: string): Promise<boolean>;
  commit(
    roomId: string,
    memberId: string,
    id: string,
    version: number,
    state: Game,
  ): Promise<{ left?: boolean }>;
}
function databaseError(
  error: { message: string; code?: string },
  operation: string,
): never {
  const { message, code } = error;
  // Log identifiers only: database details may contain private game data.
  console.error(
    "[dealz database]",
    JSON.stringify({ operation, code: code || "UNKNOWN" }),
  );
  if (code === "42501" || /permission denied|row-level security/i.test(message))
    throw new CloudError(
      "Database access denied. In Vercel, SUPABASE_SECRET_KEY must be the Supabase secret or service_role key, not the publishable or anon key. Verify both SQL migrations were run, then redeploy.",
      503,
      "DATABASE_PERMISSION_DENIED",
    );
  if (/Invalid API key|Invalid authentication credentials/i.test(message))
    throw new CloudError(
      "The backend Supabase key is invalid. Check SUPABASE_SECRET_KEY and SUPABASE_URL in Vercel, then redeploy.",
      503,
      "DATABASE_AUTH_ERROR",
    );
  if (/Stale game version/.test(message))
    throw new CloudError(
      "The table changed. Please try again.",
      409,
      "STALE_VERSION",
    );
  const safe = [
    "Room not found",
    "This seat could not be restored",
    "This game has already started",
    "This table is full",
    "That nickname is already at the table",
    "Use a nickname",
    "Room creation limit",
    "Too many moves",
    "Player is not a member",
  ];
  if (safe.some((prefix) => message.startsWith(prefix)))
    throw new CloudError(message, 400);
  if (/Could not find the function|does not exist|schema cache/.test(message))
    throw new CloudError(
      "Database setup is incomplete. Run migration 002_cloud_runtime.sql.",
      503,
      "SETUP_REQUIRED",
    );
  throw new CloudError(
    `Could not save the game (database code: ${/^[A-Z0-9]{5,12}$/.test(code || "") ? code : "UNKNOWN"}). Check Vercel Logs for the failed database operation.`,
    503,
    "DATABASE_ERROR",
  );
}
export class SupabaseGameDatabase implements CloudDatabase {
  constructor(public client: SupabaseClient) {}
  async enter(
    userId: string,
    input: Extract<OnlineRequest, { action: "enter" }>,
  ) {
    const { data, error } = await this.client.rpc("dealz_enter_room", {
      p_user_id: userId,
      p_name: input.name || null,
      p_code: input.code || null,
      p_create: !!input.create,
      p_restore: !!input.playerId,
    });
    if (error) databaseError(error, "enter_room");
    return data as Session;
  }
  async snapshot(code: string, userId: string, touch: boolean) {
    const { data, error } = await this.client.rpc("dealz_room_snapshot", {
      p_code: code,
      p_user_id: userId,
      p_touch: touch,
    });
    if (error) databaseError(error, "room_snapshot");
    return data as OnlineSnapshot | null;
  }
  async processed(roomId: string, memberId: string, id: string) {
    const { data, error } = await this.client
      .from("processed_commands")
      .select("command_id")
      .eq("room_id", roomId)
      .eq("member_id", memberId)
      .eq("command_id", id)
      .maybeSingle();
    if (error) databaseError(error, "processed_command");
    return !!data;
  }
  async commit(
    roomId: string,
    memberId: string,
    id: string,
    version: number,
    state: Game,
  ) {
    const { data, error } = await this.client.rpc("dealz_commit_move", {
      p_room_id: roomId,
      p_member_id: memberId,
      p_command_id: id,
      p_expected_version: version,
      p_state: state,
    });
    if (error) databaseError(error, "commit_move");
    return data as { left?: boolean };
  }
}
export function hydrate(snapshot: OnlineSnapshot, now = Date.now()): Game {
  const g = structuredClone(snapshot.state);
  g.version = Number(snapshot.room.version);
  g.players = snapshot.members
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((m) => {
      const p = g.players.find((p) => p.id === m.id);
      if (!p)
        throw new CloudError("Game data is incomplete. Please try again.", 503);
      return {
        ...p,
        id: m.id,
        name: m.nickname,
        token: "",
        connected: now - Date.parse(m.last_seen_at) < 75000,
        ready: m.ready,
      };
    });
  const owner = snapshot.members.find(
    (m) => m.user_id === snapshot.room.owner_user_id,
  );
  if (owner) g.owner = owner.id;
  return g;
}
export async function handleOnline(
  database: CloudDatabase,
  userId: string,
  input: unknown,
): Promise<OnlineResponse> {
  if (!input || typeof input !== "object")
    throw new CloudError("Invalid request");
  const request = input as OnlineRequest;
  if (request.action === "enter") {
    if (
      request.name !== undefined &&
      (typeof request.name !== "string" ||
        !request.name.trim() ||
        request.name.trim().length > 24)
    )
      throw new CloudError("Use a nickname of 1–24 characters");
    if (request.create !== undefined && typeof request.create !== "boolean")
      throw new CloudError("Invalid request");
    const session = await database.enter(userId, request);
    const snapshot = await database.snapshot(session.code, userId, true);
    if (!snapshot)
      throw new CloudError("This seat could not be restored", 403, "SEAT_LOST");
    return { session, view: view(hydrate(snapshot), session.playerId) };
  }
  if (
    !["state", "heartbeat", "command"].includes(request.action) ||
    typeof request.code !== "string" ||
    !/^[A-Z2-9]{6}$/.test(request.code)
  )
    throw new CloudError("Invalid room request");
  const snapshot = await database.snapshot(
    request.code,
    userId,
    request.action === "heartbeat",
  );
  if (!snapshot)
    throw new CloudError(
      "This room expired or your seat is no longer available.",
      403,
      "SEAT_LOST",
    );
  const member = snapshot.members.find((m) => m.user_id === userId);
  if (!member) throw new CloudError("Join this room first", 403, "SEAT_LOST");
  const g = hydrate(snapshot);
  if (request.action !== "command") return { view: view(g, member.id) };
  let envelope;
  try {
    envelope = validateEnvelope(request.envelope);
  } catch (error) {
    throw new CloudError((error as Error).message);
  }
  if (await database.processed(snapshot.room.id, member.id, envelope.id))
    return { view: view(g, member.id) };
  if (envelope.version !== g.version)
    throw new CloudError(
      "The table changed. Please try again.",
      409,
      "STALE_VERSION",
    );
  let next: Game;
  try {
    next = apply(
      g,
      member.id,
      envelope.command,
      () => randomInt(0, 0x100000000) / 0x100000000,
    );
  } catch (error) {
    throw new CloudError((error as Error).message);
  }
  // Cloud guests use Supabase identity; never store local session tokens.
  for (const p of next.players) p.token = "";
  const result = await database.commit(
    snapshot.room.id,
    member.id,
    envelope.id,
    envelope.version,
    next,
  );
  if (result.left || envelope.command.type === "leave") return { left: true };
  const updated = await database.snapshot(request.code, userId, false);
  if (!updated)
    throw new CloudError(
      "This room expired or your seat is no longer available.",
      403,
      "SEAT_LOST",
    );
  return { view: view(hydrate(updated), member.id) };
}
let client: SupabaseClient | undefined;
export function cloudClient() {
  if (client) return client;
  const url = process.env.SUPABASE_URL,
    secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret)
    throw new CloudError(
      "Add the server Supabase environment variables in Vercel and redeploy.",
      503,
      "SETUP_REQUIRED",
    );
  client = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(12000) }),
    },
  });
  return client;
}
