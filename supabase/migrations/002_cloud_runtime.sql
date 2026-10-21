-- Run after 001_online_game.sql. Adds the online runtime without any chat tables.
BEGIN;

CREATE OR REPLACE FUNCTION private.dealz_refresh_presence(p_room_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  r public.rooms%ROWTYPE; g jsonb; changed boolean := false;
  current_id uuid; responder_id uuid; new_owner public.room_members%ROWTYPE;
  reset_count integer; cutoff timestamptz := now() - interval '75 seconds';
BEGIN
  SELECT * INTO r FROM public.rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT state INTO g FROM public.game_state WHERE room_id=p_room_id;
  IF g IS NULL THEN RAISE EXCEPTION 'Game state has not been initialized'; END IF;
  IF r.status='playing' AND NOT coalesce((g->>'paused')::boolean,false) THEN
    current_id := (g->'players'->((g->>'turn')::integer)->>'id')::uuid;
    responder_id := (g->'pending'->>'responder')::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.room_members WHERE room_id=p_room_id AND id=current_id AND last_seen_at>=cutoff)
       OR (responder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.room_members WHERE room_id=p_room_id AND id=responder_id AND last_seen_at>=cutoff)) THEN
      g := jsonb_set(g,'{paused}','true'); changed := true;
    END IF;
  ELSIF r.status='lobby' THEN
    UPDATE public.room_members SET ready=false WHERE room_id=p_room_id AND last_seen_at<cutoff AND ready;
    GET DIAGNOSTICS reset_count=ROW_COUNT;
    changed := reset_count>0;
    IF NOT EXISTS(SELECT 1 FROM public.room_members WHERE room_id=p_room_id AND user_id=r.owner_user_id AND last_seen_at>=cutoff) THEN
      SELECT * INTO new_owner FROM public.room_members WHERE room_id=p_room_id AND last_seen_at>=cutoff ORDER BY seat LIMIT 1;
      IF FOUND THEN
        r.owner_user_id:=new_owner.user_id;
        g:=jsonb_set(g,'{owner}',to_jsonb(new_owner.id::text)); changed:=true;
      END IF;
    END IF;
  END IF;
  IF changed THEN
    g:=jsonb_set(g,'{version}',to_jsonb(r.version+1));
    UPDATE public.game_state SET state=g,updated_at=now() WHERE room_id=p_room_id;
    UPDATE public.rooms SET version=r.version+1,owner_user_id=r.owner_user_id WHERE id=p_room_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.dealz_refresh_presence(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.dealz_refresh_presence(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.dealz_enter_room(
  p_user_id uuid, p_name text DEFAULT NULL, p_code text DEFAULT NULL,
  p_create boolean DEFAULT false, p_restore boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  r public.rooms%ROWTYPE; m public.room_members%ROWTYPE;
  code text; nick text:=btrim(p_name); slot integer; g jsonb; new_player jsonb;
BEGIN
  -- Serialize repeated submissions by one guest, including concurrent creates.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  IF p_create THEN
    IF nick IS NULL OR length(nick) NOT BETWEEN 1 AND 24 THEN RAISE EXCEPTION 'Use a nickname of 1–24 characters'; END IF;
    IF (SELECT count(*) FROM public.rooms WHERE owner_user_id=p_user_id AND created_at>now()-interval '1 hour')>=5 THEN
      RAISE EXCEPTION 'Room creation limit reached. Reuse an existing room or try again later';
    END IF;
    LOOP
      code:=translate(upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),'01','GH');
      BEGIN
        INSERT INTO public.rooms(code,owner_user_id) VALUES(code,p_user_id) RETURNING * INTO r;
        EXIT;
      EXCEPTION WHEN unique_violation THEN CONTINUE;
      END;
    END LOOP;
    INSERT INTO public.room_members(room_id,user_id,nickname,seat) VALUES(r.id,p_user_id,nick,0) RETURNING * INTO m;
    new_player:=jsonb_build_object('id',m.id,'name',m.nickname,'token','','connected',true,'ready',false,'hand','[]'::jsonb,'bank','[]'::jsonb,'sets','[]'::jsonb);
    g:=jsonb_build_object('code',r.code,'owner',m.id,'players',jsonb_build_array(new_player),'status','lobby','version',0,'turn',0,'plays',0,'deck','[]'::jsonb,'discard','[]'::jsonb,'paused',false,'log',jsonb_build_array('A new online table is open'));
    INSERT INTO public.game_state(room_id,state) VALUES(r.id,g);
  ELSE
    SELECT * INTO r FROM public.rooms WHERE rooms.code=upper(p_code) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Room not found'; END IF;
    PERFORM private.dealz_refresh_presence(r.id);
    SELECT * INTO r FROM public.rooms WHERE id=r.id;
    SELECT * INTO m FROM public.room_members WHERE room_id=r.id AND user_id=p_user_id;
    IF FOUND THEN
      UPDATE public.room_members SET last_seen_at=now() WHERE id=m.id;
    ELSE
      IF p_restore THEN RAISE EXCEPTION 'This seat could not be restored'; END IF;
      IF r.status<>'lobby' THEN RAISE EXCEPTION 'This game has already started'; END IF;
      IF nick IS NULL OR length(nick) NOT BETWEEN 1 AND 24 THEN RAISE EXCEPTION 'Use a nickname of 1–24 characters'; END IF;
      IF EXISTS(SELECT 1 FROM public.room_members WHERE room_id=r.id AND lower(nickname)=lower(nick)) THEN RAISE EXCEPTION 'That nickname is already at the table'; END IF;
      SELECT s INTO slot FROM generate_series(0,4) s WHERE NOT EXISTS(SELECT 1 FROM public.room_members WHERE room_id=r.id AND seat=s) ORDER BY s LIMIT 1;
      IF slot IS NULL THEN RAISE EXCEPTION 'This table is full'; END IF;
      INSERT INTO public.room_members(room_id,user_id,nickname,seat) VALUES(r.id,p_user_id,nick,slot) RETURNING * INTO m;
      new_player:=jsonb_build_object('id',m.id,'name',m.nickname,'token','','connected',true,'ready',false,'hand','[]'::jsonb,'bank','[]'::jsonb,'sets','[]'::jsonb);
      UPDATE public.game_state SET state=jsonb_set(state,'{players}',state->'players'||jsonb_build_array(new_player)) WHERE room_id=r.id;
    END IF;
    UPDATE public.game_state SET state=jsonb_set(state,'{version}',to_jsonb(r.version+1)),updated_at=now() WHERE room_id=r.id;
    UPDATE public.rooms SET version=r.version+1,last_activity_at=now() WHERE id=r.id;
  END IF;
  RETURN jsonb_build_object('code',r.code,'playerId',m.id,'roomId',r.id,'token','');
END;
$$;
REVOKE ALL ON FUNCTION public.dealz_enter_room(uuid,text,text,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dealz_enter_room(uuid,text,text,boolean,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.dealz_room_snapshot(p_code text,p_user_id uuid,p_touch boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.rooms%ROWTYPE; result jsonb;
BEGIN
  SELECT * INTO r FROM public.rooms WHERE code=upper(p_code) FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.room_members WHERE room_id=r.id AND user_id=p_user_id) THEN RETURN NULL; END IF;
  -- Detect expired heartbeats before touching the returning player's timestamp.
  PERFORM private.dealz_refresh_presence(r.id);
  IF p_touch THEN
    UPDATE public.room_members SET last_seen_at=now() WHERE room_id=r.id AND user_id=p_user_id;
    UPDATE public.rooms SET last_activity_at=now() WHERE id=r.id AND last_activity_at<now()-interval '5 minutes';
  END IF;
  SELECT jsonb_build_object('room',to_jsonb(rooms),'state',game_state.state,'members',
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY seat) FROM public.room_members m WHERE m.room_id=r.id))
  INTO result FROM public.rooms rooms JOIN public.game_state game_state ON game_state.room_id=rooms.id WHERE rooms.id=r.id;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.dealz_room_snapshot(text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dealz_room_snapshot(text,uuid,boolean) TO service_role;

-- Extends migration 001's atomic commit to synchronize seats, readiness and leaves.
CREATE OR REPLACE FUNCTION public.dealz_commit_move(
  p_room_id uuid,p_member_id uuid,p_command_id text,p_expected_version bigint,p_state jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.rooms%ROWTYPE; previous bigint; next_version bigint; next_status text; owner_user uuid; player jsonb; seat_index integer;
BEGIN
  IF p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid command ID'; END IF;
  SELECT * INTO r FROM public.rooms WHERE id=p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.room_members WHERE room_id=p_room_id AND id=p_member_id) THEN RAISE EXCEPTION 'Player is not a member of this room'; END IF;
  SELECT resulting_version INTO previous FROM public.processed_commands WHERE room_id=p_room_id AND member_id=p_member_id AND command_id=p_command_id;
  IF FOUND THEN RETURN jsonb_build_object('version',previous,'duplicate',true); END IF;
  IF p_expected_version IS NULL OR r.version<>p_expected_version THEN RAISE EXCEPTION 'Stale game version; fetch the latest state and try again'; END IF;
  IF (SELECT count(*) FROM public.processed_commands WHERE room_id=p_room_id AND member_id=p_member_id AND created_at>now()-interval '5 seconds')>=30 THEN RAISE EXCEPTION 'Too many moves. Wait a few seconds'; END IF;
  IF p_state IS NULL OR jsonb_typeof(p_state)<>'object' OR jsonb_typeof(p_state->'players') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid game state'; END IF;
  next_status:=p_state->>'status';
  IF next_status IS NULL OR next_status NOT IN ('lobby','playing','finished') THEN RAISE EXCEPTION 'Invalid game status'; END IF;
  next_version:=r.version+1;
  IF jsonb_array_length(p_state->'players')=0 THEN
    DELETE FROM public.rooms WHERE id=p_room_id;
    RETURN jsonb_build_object('version',next_version,'duplicate',false,'left',true);
  END IF;
  SELECT user_id INTO owner_user FROM public.room_members WHERE room_id=p_room_id AND id=(p_state->>'owner')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid room owner'; END IF;
  -- Deferred seat uniqueness permits swapping two seats in one transaction.
  FOR player,seat_index IN SELECT value,(ordinality-1)::integer FROM jsonb_array_elements(p_state->'players') WITH ORDINALITY LOOP
    UPDATE public.room_members SET seat=seat_index,ready=(player->>'ready')::boolean WHERE room_id=p_room_id AND id=(player->>'id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game contains an unknown member'; END IF;
  END LOOP;
  UPDATE public.game_state SET state=p_state||jsonb_build_object('version',next_version,'code',r.code),updated_at=now() WHERE room_id=p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Game state has not been initialized'; END IF;
  UPDATE public.rooms SET version=next_version,status=next_status,owner_user_id=owner_user,last_activity_at=now(),
    finished_at=CASE WHEN next_status='finished' THEN coalesce(r.finished_at,now()) ELSE NULL END WHERE id=p_room_id;
  INSERT INTO public.processed_commands(room_id,member_id,command_id,resulting_version) VALUES(p_room_id,p_member_id,p_command_id,next_version);
  UPDATE public.room_members SET last_seen_at=now() WHERE id=p_member_id AND room_id=p_room_id;
  DELETE FROM public.room_members m WHERE room_id=p_room_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_state->'players') p WHERE (p->>'id')::uuid=m.id);
  RETURN jsonb_build_object('version',next_version,'duplicate',false,'left',NOT EXISTS(SELECT 1 FROM public.room_members WHERE room_id=p_room_id AND id=p_member_id));
END;
$$;
REVOKE ALL ON FUNCTION public.dealz_commit_move(uuid,uuid,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dealz_commit_move(uuid,uuid,text,bigint,jsonb) TO service_role;
COMMIT;
