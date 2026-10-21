-- Dealz online database, without chat. Run once in a dedicated Supabase project.
-- The Vercel API must validate rules and verify Supabase guest identity first.
BEGIN;

CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z2-9]{6}$'),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'lobby'
    CHECK (status IN ('lobby', 'playing', 'finished', 'abandoned')),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE public.room_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname varchar(24) NOT NULL CHECK (length(btrim(nickname)) BETWEEN 1 AND 24),
  seat smallint NOT NULL CHECK (seat BETWEEN 0 AND 4),
  ready boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id),
  UNIQUE (room_id, seat) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (room_id, id)
);

CREATE TABLE public.game_state (
  room_id uuid PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.processed_commands (
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  command_id text NOT NULL CHECK (length(btrim(command_id)) BETWEEN 1 AND 100),
  resulting_version bigint NOT NULL CHECK (resulting_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, member_id, command_id),
  FOREIGN KEY (room_id, member_id)
    REFERENCES public.room_members(room_id, id) ON DELETE CASCADE
);

CREATE INDEX rooms_cleanup_idx ON public.rooms(status, last_activity_at);
CREATE INDEX room_members_user_idx ON public.room_members(user_id);
CREATE INDEX room_members_seen_idx ON public.room_members(room_id, last_seen_at);

-- No browser can directly write these tables or read the complete game state.
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_commands ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.rooms, public.room_members,
  public.game_state, public.processed_commands FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rooms, public.room_members TO authenticated;
GRANT ALL ON TABLE public.rooms, public.room_members,
  public.game_state, public.processed_commands TO service_role;

-- This helper avoids recursive membership policies. The private schema must
-- remain outside Supabase's exposed API schemas; the function returns only bool.
CREATE SCHEMA IF NOT EXISTS private;
CREATE FUNCTION private.dealz_is_room_member(p_room_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_members m
    WHERE m.room_id = p_room_id AND m.user_id = (SELECT auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION private.dealz_is_room_member(uuid) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.dealz_is_room_member(uuid)
  TO authenticated, service_role;

CREATE POLICY rooms_member_read ON public.rooms
  FOR SELECT TO authenticated
  USING (private.dealz_is_room_member(id));

-- Browser membership reads reveal only the caller's own seat.
-- The API supplies the public roster in its personalized game response.
CREATE POLICY members_own_seat_read ON public.room_members
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Server-only atomic commit. This does NOT implement card rules in SQL.
-- The API validates the move using the TypeScript engine, then calls this RPC.
CREATE FUNCTION public.dealz_commit_move(
  p_room_id uuid,
  p_member_id uuid,
  p_command_id text,
  p_expected_version bigint,
  p_state jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_previous bigint;
  v_next bigint;
  v_status text;
BEGIN
  IF p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid command ID';
  END IF;

  -- All concurrent commands for this room serialize on this lock.
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_id = p_room_id AND id = p_member_id
  ) THEN RAISE EXCEPTION 'Player is not a member of this room'; END IF;

  SELECT resulting_version INTO v_previous FROM public.processed_commands
  WHERE room_id = p_room_id AND member_id = p_member_id AND command_id = p_command_id;
  IF FOUND THEN
    RETURN jsonb_build_object('version', v_previous, 'duplicate', true);
  END IF;

  IF p_expected_version IS NULL OR v_room.version <> p_expected_version THEN
    RAISE EXCEPTION 'Stale game version; fetch the latest state and try again';
  END IF;
  IF p_state IS NULL OR jsonb_typeof(p_state) <> 'object' THEN
    RAISE EXCEPTION 'Game state must be an object';
  END IF;
  v_status := p_state ->> 'status';
  IF v_status IS NULL OR v_status NOT IN ('lobby', 'playing', 'finished', 'abandoned') THEN
    RAISE EXCEPTION 'Invalid game status';
  END IF;

  v_next := v_room.version + 1;
  UPDATE public.game_state
  SET state = p_state || jsonb_build_object('version', v_next, 'code', v_room.code),
      updated_at = now()
  WHERE room_id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Game state has not been initialized'; END IF;

  UPDATE public.rooms
  SET version = v_next, status = v_status, last_activity_at = now(),
      finished_at = CASE WHEN v_status IN ('finished', 'abandoned')
        THEN coalesce(v_room.finished_at, now()) ELSE NULL END
  WHERE id = p_room_id;

  INSERT INTO public.processed_commands
    (room_id, member_id, command_id, resulting_version)
  VALUES (p_room_id, p_member_id, p_command_id, v_next);

  RETURN jsonb_build_object('version', v_next, 'duplicate', false);
END;
$$;
REVOKE ALL ON FUNCTION public.dealz_commit_move(uuid, uuid, text, bigint, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dealz_commit_move(uuid, uuid, text, bigint, jsonb)
  TO service_role;

-- Deletes ended rooms and rooms with no activity or player heartbeat for 24h.
-- The online API must maintain room activity and member heartbeat timestamps.
CREATE FUNCTION public.dealz_cleanup_rooms()
RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  DELETE FROM public.rooms r
  WHERE r.status IN ('finished', 'abandoned')
     OR (
       r.last_activity_at < now() - interval '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM public.room_members m
         WHERE m.room_id = r.id AND m.last_seen_at >= now() - interval '24 hours'
       )
     );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.dealz_cleanup_rooms() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dealz_cleanup_rooms() TO service_role;

-- Publish only safe room metadata. Never publish game_state or commands.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rooms'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
    END IF;
  END IF;
END;
$$;

COMMIT;
