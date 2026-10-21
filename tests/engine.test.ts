import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeDeck } from "../shared/deck.js";
import { apply, view, complete, rent } from "../shared/engine.js";
import { Store } from "../server/store.js";
import type { Game, Card, Player, Color, SetGroup } from "../shared/model.js";
const deck = makeDeck();
let sequence = 500;
function card(match: Partial<Card>): Card {
  const c = deck.find((c) =>
    Object.entries(match).every(
      ([k, v]) => JSON.stringify(c[k as keyof Card]) === JSON.stringify(v),
    ),
  );
  assert.ok(c, JSON.stringify(match));
  return { ...structuredClone(c), id: `test-${sequence++}` };
}
const action = (a: Card["action"]) => card({ action: a });
function player(id: string): Player {
  return {
    id,
    token: `secret-${id}`,
    name: id,
    connected: true,
    ready: true,
    hand: [],
    sets: [],
    bank: [],
  };
}
function game(): Game {
  return {
    code: "ABC234",
    owner: "a",
    players: [player("a"), player("b")],
    status: "playing",
    version: 1,
    turn: 0,
    plays: 0,
    deck: makeDeck(),
    discard: [],
    paused: false,
    log: [],
  };
}
function set(color: Color, n: number, buildings: Card[] = []): SetGroup {
  return {
    id: `s${sequence++}`,
    color,
    cards: Array.from({ length: n }, () =>
      card({ kind: "property", colors: [color] }),
    ),
    buildings,
  };
}
function play(g: Game, c: Card, extra: object = {}) {
  g.players[0].hand.push(c);
  return apply(g, "a", { type: "play", cardId: c.id, ...extra });
}
function accept(g: Game) {
  return apply(g, g.pending!.responder, { type: "respond", no: false });
}

test("106 playable cards, unique IDs, standard deck composition", () => {
  assert.equal(deck.length, 106);
  assert.equal(new Set(deck.map((c) => c.id)).size, 106);
  assert.equal(deck.filter((c) => c.kind === "property").length, 28);
  assert.equal(deck.filter((c) => c.kind === "wild").length, 11);
  assert.equal(deck.filter((c) => c.kind === "rent").length, 13);
  assert.equal(deck.filter((c) => c.kind === "action").length, 34);
  assert.equal(deck.filter((c) => c.kind === "money").length, 20);
});
test("lobby readiness, seat swap, dealing and turn draw", () => {
  let g = game();
  g.status = "lobby";
  g = apply(g, "b", { type: "seat", seat: 0 });
  assert.equal(g.players[0].id, "b");
  g = apply(g, "a", { type: "start" }, () => 0.4);
  assert.equal(g.players[0].hand.length, 7);
  assert.equal(g.players[1].hand.length, 5);
  assert.equal(g.deck.length, 94);
  assert.throws(() => apply(g, "a", { type: "end" }), /not your turn/);
});
test("banking and three-play limit; rejected commands do not mutate input", () => {
  let g = game();
  for (let i = 0; i < 3; i++)
    g = play(g, card({ kind: "money", value: 1 }), { mode: "bank" });
  const snapshot = JSON.stringify(g);
  assert.throws(() => play(structuredClone(g), action("passGo")), /all three/);
  assert.equal(JSON.stringify(g), snapshot);
  assert.equal(g.players[0].bank.length, 3);
});
test("properties cannot bank; colours validated; wild moves cost no plays", () => {
  let g = game();
  assert.throws(
    () =>
      play(g, card({ kind: "property", colors: ["brown"] }), { mode: "bank" }),
    /cannot be banked/,
  );
  g = game();
  const w = card({ kind: "wild", colors: ["brown", "lightBlue"] });
  g = play(g, w, { color: "brown" });
  const before = g.plays;
  g = apply(g, "a", { type: "move", cardId: w.id, color: "lightBlue" });
  assert.equal(g.plays, before);
  assert.equal(g.players[0].sets[0].color, "lightBlue");
  assert.throws(
    () => apply(g, "a", { type: "move", cardId: w.id, color: "red" }),
    /allowed colour/,
  );
});
test("Pass Go, empty-hand draws five, deck reshuffle", () => {
  let g = game();
  g = play(g, action("passGo"));
  assert.equal(g.players[0].hand.length, 2);
  g = apply(g, "a", { type: "end" });
  assert.equal(g.players[1].hand.length, 5);
  g = game();
  g.deck = [];
  g.discard = [
    card({ kind: "money", value: 1 }),
    card({ kind: "money", value: 2 }),
  ];
  g = play(g, action("passGo"));
  assert.equal(g.players[0].hand.length, 2);
  assert.equal(g.discard.length, 1);
});
test("discard exactly to seven ends turn; duplicate selection rejected", () => {
  let g = game();
  g.players[0].hand = makeDeck().slice(0, 9);
  assert.throws(() => apply(g, "a", { type: "end" }), /Discard/);
  assert.throws(
    () => apply(g, "a", { type: "discard", cardIds: ["c1", "c1"] }),
    /Discard/,
  );
  g = apply(g, "a", { type: "discard", cardIds: ["c1", "c2"] });
  assert.equal(g.players[0].hand.length, 7);
  assert.equal(g.turn, 1);
});
test("house and hotel restrictions and rent bonuses", () => {
  let g = game();
  g.players[0].sets = [set("brown", 2)];
  const sid = g.players[0].sets[0].id;
  assert.throws(() => play(g, action("hotel"), { setId: sid }), /house before/);
  g = game();
  g.players[0].sets = [set("brown", 2)];
  const s = g.players[0].sets[0].id;
  g = play(g, action("house"), { setId: s });
  g = play(g, action("hotel"), { setId: s });
  assert.equal(rent(g.players[0].sets[0]), 9);
  assert.throws(
    () => play(g, action("house"), { setId: s }),
    /already present/,
  );
  g = game();
  g.players[0].sets = [set("railroad", 4)];
  assert.throws(
    () => play(g, action("house"), { setId: g.players[0].sets[0].id }),
    /coloured set/,
  );
});
test("rent with two doubles costs three plays and charges everyone in sequence", () => {
  let g = game();
  g.players.push(player("c"));
  g.players[0].sets = [set("brown", 2)];
  const d1 = action("double"),
    d2 = action("double");
  g.players[0].hand = [d1, d2];
  g = play(g, card({ kind: "rent", colors: ["brown", "lightBlue"] }), {
    setId: g.players[0].sets[0].id,
    doubleIds: [d1.id, d2.id],
  });
  assert.equal(g.plays, 3);
  assert.equal(g.pending?.effect.amount, 8);
  g = accept(g);
  g = apply(g, "b", { type: "pay", cardIds: [] });
  assert.equal(g.pending?.effect.target, "c");
  g = accept(g);
  g = apply(g, "c", { type: "pay", cardIds: [] });
  assert.equal(g.pending, undefined);
});
test("any-colour rent targets one player and rejects self", () => {
  let g = game();
  g.players[0].sets = [set("brown", 1)];
  g = play(g, card({ kind: "rent", value: 3 }), {
    setId: g.players[0].sets[0].id,
    target: "b",
  });
  assert.equal(g.pending?.effects.length, 0);
  assert.equal(g.pending?.effect.target, "b");
});
test("Just Say No chain alternates, consumes cards, and keeps play count", () => {
  let g = game();
  g.players[0].hand = [action("no")];
  g.players[1].hand = [action("no")];
  g = play(g, action("debt"), { target: "b" });
  g = apply(g, "b", { type: "respond", no: true });
  assert.equal(g.pending?.cancelled, true);
  assert.equal(g.pending?.responder, "a");
  g = apply(g, "a", { type: "respond", no: true });
  assert.equal(g.pending?.cancelled, false);
  g = accept(g);
  assert.equal(g.pending?.stage, "payment");
  assert.equal(g.plays, 1);
});
test("block cancels only that player in a birthday action", () => {
  let g = game();
  g.players.push(player("c"));
  g.players[1].hand = [action("no")];
  g = play(g, action("birthday"));
  g = apply(g, "b", { type: "respond", no: true });
  g = accept(g);
  assert.equal(g.pending?.effect.target, "c");
  assert.equal(g.pending?.effect.amount, 2);
});
test("payments use table assets only, overpay without change, short pays all", () => {
  let g = game();
  const ten = card({ kind: "money", value: 10 });
  g.players[1].bank = [ten];
  g = play(g, action("debt"), { target: "b" });
  g = accept(g);
  assert.throws(() => apply(g, "b", { type: "pay", cardIds: [] }), /enough/);
  assert.throws(
    () => apply(g, "b", { type: "pay", cardIds: [ten.id, ten.id] }),
    /Duplicate/,
  );
  g = apply(g, "b", { type: "pay", cardIds: [ten.id] });
  assert.equal(g.players[0].bank[0].value, 10);
  assert.equal(g.players[1].bank.length, 0);
  g = game();
  const one = card({ kind: "money", value: 1 });
  g.players[1].bank = [one];
  g = accept(play(g, action("debt"), { target: "b" }));
  g = apply(g, "b", { type: "pay", cardIds: [one.id] });
  assert.equal(g.pending, undefined);
});
test("property payments break sets; orphan buildings become money", () => {
  let g = game();
  const s = set("brown", 2, [action("house"), action("hotel")]);
  g.players[1].sets = [s];
  g = accept(play(g, action("debt"), { target: "b" }));
  g = apply(g, "b", {
    type: "pay",
    cardIds: [s.cards[0].id, s.buildings[1].id],
  });
  assert.equal(g.players[1].bank[0].action, "house");
  assert.equal(g.players[0].sets[0].cards.length, 1);
});
test("Sly Deal protects complete sets and takes incomplete properties", () => {
  let g = game();
  g.players[1].sets = [set("brown", 2)];
  assert.throws(
    () =>
      play(g, action("slyDeal"), {
        target: "b",
        targetCard: g.players[1].sets[0].cards[0].id,
      }),
    /complete set/,
  );
  g = game();
  const s = set("red", 1);
  g.players[1].sets = [s];
  g = accept(
    play(g, action("slyDeal"), { target: "b", targetCard: s.cards[0].id }),
  );
  assert.equal(g.players[0].sets[0].color, "red");
  assert.equal(g.players[1].sets.length, 0);
});
test("Forced Deal exchanges both cards", () => {
  let g = game();
  const a = set("brown", 1),
    b = set("red", 1);
  g.players[0].sets = [a];
  g.players[1].sets = [b];
  g = accept(
    play(g, action("forcedDeal"), {
      target: "b",
      targetCard: b.cards[0].id,
      giveCard: a.cards[0].id,
    }),
  );
  assert.equal(g.players[0].sets[0].color, "red");
  assert.equal(g.players[1].sets[0].color, "brown");
});
test("Deal Breaker transfers buildings with complete set and can trigger victory", () => {
  let g = game();
  g.players[0].sets = [set("brown", 2), set("darkBlue", 2)];
  const s = set("red", 3, [action("house")]);
  g.players[1].sets = [s];
  g = accept(play(g, action("dealBreaker"), { target: "b", targetSet: s.id }));
  assert.equal(g.status, "finished");
  assert.equal(g.winner, "a");
  assert.equal(g.players[0].sets[2].buildings.length, 1);
});
test("three different colours required for victory", () => {
  let g = game();
  g.players[0].sets = [set("brown", 2), set("brown", 2), set("red", 3)];
  g = play(g, card({ kind: "property", colors: ["darkBlue"] }), {
    color: "darkBlue",
  });
  assert.equal(g.status, "playing");
  g = play(g, card({ kind: "property", colors: ["darkBlue"] }), {
    color: "darkBlue",
  });
  assert.equal(g.winner, "a");
});
test("private views contain neither opponents hands, tokens nor draw order", () => {
  const g = game();
  g.players[1].hand = [action("no")];
  const v = view(g, "a");
  assert.equal(v.players[1].hand, undefined);
  assert.equal(v.players[1].handCount, 1);
  assert.ok(!JSON.stringify(v).includes("secret-"));
  assert.ok(!("deck" in v));
  assert.equal(v.deckCount, 106);
});
test("pause, owner authorization, rematch and lobby departure", () => {
  let g = game();
  g.paused = true;
  assert.throws(() => apply(g, "a", { type: "end" }), /paused/);
  assert.throws(() => apply(g, "b", { type: "resume" }), /owner/);
  g.players[0].connected = false;
  assert.throws(() => apply(g, "a", { type: "resume" }), /reconnect/);
  g.players[0].connected = true;
  g = apply(g, "a", { type: "resume" });
  assert.equal(g.paused, false);
  g = apply(g, "a", { type: "endGame" });
  g = apply(g, "a", { type: "rematch" });
  assert.equal(g.status, "lobby");
  assert.ok(g.players.every((p) => !p.ready));
  g = apply(g, "a", { type: "leave" });
  assert.equal(g.owner, "b");
});
test("persistent store: duplicate commands idempotent, stale moves rejected, recovery paused", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dealz-test-"));
  try {
    const s = new Store(dir);
    const g = game();
    const c = card({ kind: "money", value: 1 });
    g.players[0].hand = [c];
    s.save({ game: g, seen: {} });
    const envelope = {
      id: "request-1",
      version: 1,
      command: { type: "play" as const, cardId: c.id, mode: "bank" as const },
    };
    s.command(g.code, "a", envelope);
    s.command(g.code, "a", envelope);
    assert.equal(s.rooms.get(g.code)?.game.version, 2);
    assert.throws(
      () => s.command(g.code, "a", { ...envelope, id: "new" }),
      /changed/,
    );
    const recovered = new Store(dir);
    assert.equal(recovered.rooms.get(g.code)?.game.paused, true);
    assert.ok(
      recovered.rooms.get(g.code)?.game.players.every((p) => !p.connected),
    );
    assert.equal(recovered.rooms.get(g.code)?.game.players[0].bank.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("complete simulated games at 2 and 5 players conserve every card", () => {
  for (const count of [2, 5]) {
    let g = game();
    g.status = "lobby";
    g.players = Array.from({ length: count }, (_, i) =>
      player(String.fromCharCode(97 + i)),
    );
    let seed = 1234;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    g = apply(g, "a", { type: "start" }, rng);
    let moves = 0;
    while (g.status === "playing" && moves++ < 1500) {
      const p = g.players[g.turn];
      if (g.pending) {
        const r = g.players.find((p) => p.id === g.pending!.responder)!;
        g = apply(
          g,
          r.id,
          g.pending.stage === "response"
            ? { type: "respond", no: false }
            : {
                type: "pay",
                cardIds: [
                  ...r.bank,
                  ...r.sets.flatMap((s) => [...s.cards, ...s.buildings]),
                ]
                  .filter((c) => c.value > 0)
                  .map((c) => c.id),
              },
          rng,
        );
      } else if (g.plays < 3 && p.hand.length) {
        const prop = p.hand.find(
          (c) => c.kind === "property" || c.kind === "wild",
        );
        const debt = p.hand.find(
          (c) => c.action === "debt" || c.action === "birthday",
        );
        const breaker = p.hand.find((c) => c.action === "dealBreaker");
        const target = g.players.find(
          (q) => q.id !== p.id && q.sets.some(complete),
        );
        if (breaker && target)
          g = apply(
            g,
            p.id,
            {
              type: "play",
              cardId: breaker.id,
              target: target.id,
              targetSet: target.sets.find(complete)!.id,
            },
            rng,
          );
        else if (prop) {
          const color =
            prop.colors!.find(
              (color) => !p.sets.some((s) => s.color === color && complete(s)),
            ) || prop.colors![0];
          g = apply(g, p.id, { type: "play", cardId: prop.id, color }, rng);
        } else if (debt)
          g = apply(
            g,
            p.id,
            {
              type: "play",
              cardId: debt.id,
              target:
                g.players.find((q) => q.id !== p.id && q.sets.length)?.id ||
                g.players.find((q) => q.id !== p.id)!.id,
            },
            rng,
          );
        else {
          const c = p.hand[0];
          g = apply(
            g,
            p.id,
            {
              type: "play",
              cardId: c.id,
              ...(c.action === "passGo" ? {} : { mode: "bank" as const }),
            },
            rng,
          );
        }
      } else if (p.hand.length > 7)
        g = apply(
          g,
          p.id,
          { type: "discard", cardIds: p.hand.slice(7).map((c) => c.id) },
          rng,
        );
      else g = apply(g, p.id, { type: "end" }, rng);
      const all = [
        ...g.deck,
        ...g.discard,
        ...g.players.flatMap((p) => [
          ...p.hand,
          ...p.bank,
          ...p.sets.flatMap((s) => [...s.cards, ...s.buildings]),
        ]),
      ];
      assert.equal(all.length, 106);
      assert.equal(new Set(all.map((c) => c.id)).size, 106);
    }
    assert.equal(
      g.status,
      "finished",
      `${count} players should finish in ${moves} moves`,
    );
  }
});

test("buildings move freely between eligible sets in dependency order", () => {
  let g = game();
  const house = action("house"),
    hotel = action("hotel");
  const source = set("brown", 2, [house, hotel]),
    dest = set("red", 3, [action("house")]);
  g.players[0].sets = [source, dest];
  assert.throws(
    () =>
      apply(g, "a", { type: "moveBuilding", cardId: house.id, setId: dest.id }),
    /already has/,
  );
  g = apply(g, "a", { type: "moveBuilding", cardId: hotel.id, setId: dest.id });
  assert.equal(g.plays, 0);
  assert.equal(g.players[0].sets[1].buildings.length, 2);
});
test("owner releases disconnected lobby seats without affecting connected players", () => {
  let g = game();
  g.status = "lobby";
  assert.throws(
    () => apply(g, "a", { type: "kick", playerId: "b" }),
    /disconnected/,
  );
  g.players[1].connected = false;
  g = apply(g, "a", { type: "kick", playerId: "b" });
  assert.equal(g.players.length, 1);
});
test("transition to an already disconnected responder pauses the saved game", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dealz-offline-"));
  try {
    const store = new Store(dir),
      g = game();
    const c = action("debt");
    g.players[0].hand = [c];
    g.players[1].connected = false;
    store.save({ game: g, seen: {} });
    const result = store.command(g.code, "a", {
      id: "offline-target",
      version: g.version,
      command: { type: "play", cardId: c.id, target: "b" },
    });
    assert.equal(result.game.paused, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("moving a group’s founding wildcard into a new group preserves unique IDs", () => {
  let g = game();
  const w = card({ kind: "wild", colors: ["brown", "lightBlue"] });
  g = play(g, w, { color: "brown" });
  g = play(g, card({ kind: "property", colors: ["brown"] }), {
    color: "brown",
  });
  g = apply(g, "a", {
    type: "move",
    cardId: w.id,
    color: "lightBlue",
    setId: "new",
  });
  assert.equal(g.players[0].sets.length, 2);
  assert.equal(new Set(g.players[0].sets.map((s) => s.id)).size, 2);
});
test("payment victory finishes immediately before remaining birthday targets", () => {
  let g = game();
  g.players.push(player("c"));
  g.players[0].sets = [set("brown", 2), set("darkBlue", 2), set("red", 2)];
  const property = set("red", 1);
  g.players[1].sets = [property];
  g = accept(play(g, action("birthday")));
  g = apply(g, "b", { type: "pay", cardIds: [property.cards[0].id] });
  assert.equal(g.status, "finished");
  assert.equal(g.winner, "a");
  assert.equal(g.pending, undefined);
});

test("ordinary properties can regroup in their printed colour without using a play", () => {
  let g = game();
  const s = set("red", 2);
  g.players[0].sets = [s];
  g = apply(g, "a", {
    type: "move",
    cardId: s.cards[0].id,
    color: "red",
    setId: "new",
  });
  assert.equal(g.plays, 0);
  assert.equal(g.players[0].sets.length, 2);
  assert.throws(
    () =>
      apply(g, "a", { type: "move", cardId: s.cards[0].id, color: "brown" }),
    /allowed colour/,
  );
});
