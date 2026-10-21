import { test } from "node:test";
import assert from "node:assert/strict";
import { handleOnline, hydrate, type CloudDatabase } from "../server/cloud.js";
import type { OnlineSnapshot } from "../shared/online.js";
import { makeDeck } from "../shared/deck.js";
function fixture() {
  const state: OnlineSnapshot = {
    room: { id: "room", code: "ABC234", version: 4, owner_user_id: "guest-a" },
    members: ["a", "b"].map((id, seat) => ({
      id,
      user_id: `guest-${id}`,
      room_id: "room",
      nickname: id,
      seat,
      ready: true,
      last_seen_at: new Date().toISOString(),
    })),
    state: {
      code: "ABC234",
      owner: "a",
      players: ["a", "b"].map((id) => ({
        id,
        name: id,
        token: "secret",
        connected: true,
        ready: true,
        hand: makeDeck().slice(0, 5),
        bank: [],
        sets: [],
      })),
      status: "playing",
      version: 4,
      turn: 0,
      plays: 0,
      deck: makeDeck().slice(10),
      discard: [],
      paused: false,
      log: [],
    },
  };
  let commits = 0,
    duplicate = false;
  const db: CloudDatabase = {
    enter: async () => ({
      code: "ABC234",
      playerId: "a",
      token: "",
      roomId: "room",
    }),
    snapshot: async (_code, user) =>
      state.members.some((m) => m.user_id === user)
        ? structuredClone(state)
        : null,
    processed: async () => duplicate,
    commit: async (_r, _m, _id, v, g) => {
      commits++;
      state.state = g;
      state.room.version = v + 1;
      return {};
    },
  };
  return {
    state,
    db,
    get commits() {
      return commits;
    },
    setDuplicate() {
      duplicate = true;
    },
  };
}
test("online state derives identity from authenticated guest and hides private cards", async () => {
  const f = fixture();
  const r = await handleOnline(f.db, "guest-b", {
    action: "state",
    code: "ABC234",
    playerId: "a",
  });
  assert.equal(r.view?.you, "b");
  assert.equal(r.view?.players[0].hand, undefined);
  assert.equal(r.view?.players[1].hand?.length, 5);
  assert.ok(!JSON.stringify(r).includes("secret"));
  assert.ok(!("deck" in r.view!));
  await assert.rejects(
    handleOnline(f.db, "intruder", { action: "state", code: "ABC234" }),
    /seat/,
  );
});
test("online rejects stale and forged commands before saving and deduplicates retries", async () => {
  const f = fixture();
  await assert.rejects(
    handleOnline(f.db, "guest-a", {
      action: "command",
      code: "ABC234",
      envelope: { id: "x", version: 3, command: { type: "end" } },
    }),
    /changed/,
  );
  await assert.rejects(
    handleOnline(f.db, "guest-b", {
      action: "command",
      code: "ABC234",
      envelope: { id: "x", version: 4, command: { type: "end" } },
    }),
    /turn/,
  );
  assert.equal(f.commits, 0);
  f.setDuplicate();
  await handleOnline(f.db, "guest-a", {
    action: "command",
    code: "ABC234",
    envelope: { id: "x", version: 0, command: { type: "end" } },
  });
  assert.equal(f.commits, 0);
});
test("online move advances saved state and rejects chat commands", async () => {
  const f = fixture();
  const r = await handleOnline(f.db, "guest-a", {
    action: "command",
    code: "ABC234",
    envelope: { id: "x", version: 4, command: { type: "end" } },
  });
  assert.equal(f.commits, 1);
  assert.equal(r.view?.version, 5);
  assert.equal(r.view?.turn, 1);
  await assert.rejects(
    handleOnline(f.db, "guest-a", { action: "chat", code: "ABC234" }),
    /Invalid/,
  );
});
test("online presence uses heartbeats, and replaces untrusted saved identity fields", () => {
  const f = fixture();
  f.state.members[1].last_seen_at = new Date(Date.now() - 80000).toISOString();
  const g = hydrate(f.state);
  assert.equal(g.players[1].connected, false);
  assert.equal(g.players[0].token, "");
  assert.equal(g.owner, "a");
});
