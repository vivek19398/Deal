-- Run against a disposable database with migrations 001 and 002 and two auth users.
BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE a jsonb; b jsonb; snapshot jsonb; g jsonb; result jsonb; v bigint;
 u1 uuid:='11111111-1111-1111-1111-111111111111';
 u2 uuid:='22222222-2222-2222-2222-222222222222';
BEGIN
 a:=public.dealz_enter_room(u1,'Bihar Host',null,true,false);
 b:=public.dealz_enter_room(u2,'Patna Player',a->>'code',false,false);
 snapshot:=public.dealz_room_snapshot(a->>'code',u1,true);
 IF jsonb_array_length(snapshot->'members')<>2 OR jsonb_array_length(snapshot->'state'->'players')<>2 THEN RAISE EXCEPTION 'Join failed'; END IF;
 IF public.dealz_room_snapshot(a->>'code',gen_random_uuid(),false) IS NOT NULL THEN RAISE EXCEPTION 'Nonmember read succeeded'; END IF;
 IF public.dealz_enter_room(u2,null,a->>'code',false,true)->>'playerId'<>b->>'playerId' THEN RAISE EXCEPTION 'Restore changed identity'; END IF;
 snapshot:=public.dealz_room_snapshot(a->>'code',u1,false);v:=(snapshot->'room'->>'version')::bigint;
 g:=snapshot->'state';g:=jsonb_set(g,'{players}',jsonb_build_array(g->'players'->1,g->'players'->0));
 result:=public.dealz_commit_move((a->>'roomId')::uuid,(a->>'playerId')::uuid,'swap',v,g);
 IF (SELECT seat FROM public.room_members WHERE id=(a->>'playerId')::uuid)<>1 THEN RAISE EXCEPTION 'Seat swap failed'; END IF;
 result:=public.dealz_commit_move((a->>'roomId')::uuid,(a->>'playerId')::uuid,'swap',v,g);
 IF NOT (result->>'duplicate')::boolean THEN RAISE EXCEPTION 'Duplicate was reapplied'; END IF;
 BEGIN
  PERFORM public.dealz_commit_move((a->>'roomId')::uuid,(a->>'playerId')::uuid,'stale',v,g);
  RAISE EXCEPTION 'Stale version accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Stale game version%' THEN RAISE; END IF;
 END;
 snapshot:=public.dealz_room_snapshot(a->>'code',u1,false);v:=(snapshot->'room'->>'version')::bigint;g:=snapshot->'state';
 g:=jsonb_set(g,'{status}','"playing"');
 PERFORM public.dealz_commit_move((a->>'roomId')::uuid,(a->>'playerId')::uuid,'start',v,g);
 UPDATE public.room_members SET last_seen_at=now()-interval '2 minutes' WHERE id=(b->>'playerId')::uuid;
 snapshot:=public.dealz_room_snapshot(a->>'code',u1,true);
 IF NOT (snapshot->'state'->>'paused')::boolean THEN RAISE EXCEPTION 'Absent current player did not pause'; END IF;
 PERFORM public.dealz_room_snapshot(a->>'code',u2,true);
 snapshot:=public.dealz_room_snapshot(a->>'code',u1,false);
 IF NOT (snapshot->'state'->>'paused')::boolean THEN RAISE EXCEPTION 'Reconnect resumed without owner'; END IF;
END $$;
ROLLBACK;
