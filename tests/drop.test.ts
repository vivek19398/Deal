import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeDeck } from "../shared/deck.js";
import { dropIntent } from "../shared/drop.js";
import { apply, view } from "../shared/engine.js";
import { Store } from "../server/store.js";
import { money, places } from "../shared/theme.js";
import type { Card, Game, SetGroup, Color } from "../shared/model.js";
const property = (color: Color) =>
  structuredClone(
    makeDeck().find((c) => c.kind === "property" && c.colors?.[0] === color)!,
  );
function setup() {
  const deck = makeDeck();
  return {
    code: "BIHAR2",
    owner: "me",
    players: ["me", "friend"].map((id) => ({
      id,
      name: id,
      token: id + "-secret",
      connected: true,
      ready: true,
      hand: [],
      sets: [],
      bank: [],
    })),
    status: "playing",
    version: 1,
    turn: 0,
    plays: 0,
    deck,
    discard: [],
    paused: false,
    log: [],
  } as Game;
}
const group = (c: Card, id = "yellow-set"): SetGroup => ({
  id,
  color: c.colors![0],
  cards: [c],
  buildings: [],
});
test("Bihar deck has named properties and whole-crore INR money with ₹1 cr minimum", () => {
  const deck = makeDeck();
  for (const name of [
    "Jagdeo Path",
    "Manopali",
    "Mahaura",
    "Bhagalpur",
    "PWC Department",
  ])
    assert.ok(deck.some((c) => c.name === name));
  assert.equal(deck.filter((c) => c.kind === "property").length, 28);
  assert.equal(
    new Set(deck.filter((c) => c.kind === "property").map((c) => c.name)).size,
    28,
  );
  assert.equal(
    Math.min(...deck.filter((c) => c.kind === "money").map((c) => c.value)),
    1,
  );
  assert.ok(
    deck
      .filter((c) => c.kind === "money")
      .every((c) => Number.isInteger(c.value) && c.name === money(c.value)),
  );
  assert.equal(money(5), "₹5 cr");
  assert.equal(places.utility.length, 2);
});
test("red on yellow is rejected by drag routing and by the server with forged commands", () => {
  const g = setup(),
    red = property("red"),
    yellow = property("yellow");
  g.players[0].hand = [red];
  g.players[0].sets = [group(yellow)];
  const snapshot = JSON.stringify(g);
  assert.throws(
    () =>
      dropIntent(view(g, "me"), red.id, false, {
        zone: "group",
        owner: "me",
        setId: "yellow-set",
        color: "red",
      }),
    /colours must match/,
  );
  assert.throws(
    () =>
      apply(g, "me", {
        type: "play",
        cardId: red.id,
        color: "red",
        setId: "yellow-set",
      }),
    /Invalid destination/,
  );
  assert.throws(
    () =>
      apply(g, "me", {
        type: "play",
        cardId: red.id,
        color: "yellow",
        setId: "yellow-set",
      }),
    /allowed colour/,
  );
  assert.equal(JSON.stringify(g), snapshot);
});
test("properties cannot drop on opponents, and guessed opponent set IDs are rejected", () => {
  const g = setup(),
    red = property("red");
  g.players[0].hand = [red];
  g.players[1].sets = [group(property("yellow"), "opponent-set")];
  assert.throws(
    () =>
      dropIntent(view(g, "me"), red.id, false, {
        zone: "group",
        owner: "friend",
        setId: "opponent-set",
      }),
    /another player/,
  );
  assert.throws(
    () =>
      apply(g, "me", {
        type: "play",
        cardId: red.id,
        color: "red",
        setId: "opponent-set",
      }),
    /Invalid destination/,
  );
});
test("legal property drops produce the same authoritative commands as clicking", () => {
  let g = setup();
  const cards = makeDeck().filter(
    (c) => c.kind === "property" && c.colors?.[0] === "yellow",
  );
  g.players[0].hand = [cards[1]];
  g.players[0].sets = [group(cards[0])];
  const intent = dropIntent(view(g, "me"), cards[1].id, false, {
    zone: "group",
    owner: "me",
    setId: "yellow-set",
  });
  assert.ok("command" in intent);
  g = apply(g, "me", intent.command);
  assert.equal(g.players[0].sets[0].cards.length, 2);
  assert.equal(g.plays, 1);
  assert.equal(g.players[0].hand.length, 0);
});
test("money drop banks only into own bank; properties cannot be banked", () => {
  const g = setup(),
    cash = makeDeck().find((c) => c.kind === "money")!,
    red = property("red");
  g.players[0].hand = [cash, red];
  assert.throws(
    () =>
      dropIntent(view(g, "me"), cash.id, false, {
        zone: "bank",
        owner: "friend",
      }),
    /own bank/,
  );
  assert.throws(
    () =>
      dropIntent(view(g, "me"), red.id, false, { zone: "bank", owner: "me" }),
    /cannot be banked/,
  );
  const intent = dropIntent(view(g, "me"), cash.id, false, {
    zone: "bank",
    owner: "me",
  });
  assert.ok("command" in intent);
  assert.equal(apply(g, "me", intent.command).players[0].bank[0].name, "₹1 cr");
});
test("wildcard drops enforce printed colours and set capacity", () => {
  const g = setup(),
    wild = makeDeck().find(
      (c) =>
        c.kind === "wild" &&
        c.colors?.length === 2 &&
        c.colors.includes("brown"),
    )!;
  g.players[0].hand = [wild];
  g.players[0].sets = [group(property("red"), "red-set")];
  assert.throws(
    () =>
      dropIntent(view(g, "me"), wild.id, false, {
        zone: "group",
        owner: "me",
        setId: "red-set",
      }),
    /colours must match/,
  );
  g.players[0].sets = [
    {
      id: "brown-set",
      color: "brown",
      cards: makeDeck().filter(
        (c) => c.kind === "property" && c.colors?.[0] === "brown",
      ),
      buildings: [],
    },
  ];
  const intent = dropIntent(view(g, "me"), wild.id, false, {
    zone: "group",
    owner: "me",
    setId: "brown-set",
  });
  assert.ok("command" in intent);
  assert.throws(() => apply(g, "me", intent.command), /group is full/);
});
test("out-of-turn and paused drag gestures never produce a command", () => {
  const g = setup(),
    red = property("red");
  g.players[0].hand = [red];
  g.turn = 1;
  assert.throws(
    () =>
      dropIntent(view(g, "me"), red.id, false, { zone: "new", owner: "me" }),
    /your turn/,
  );
  g.turn = 0;
  g.paused = true;
  assert.throws(
    () =>
      dropIntent(view(g, "me"), red.id, false, { zone: "new", owner: "me" }),
    /paused/,
  );
});
test("action drops preserve chosen opponent/property and open required choices", () => {
  const g = setup(),
    sly = makeDeck().find((c) => c.action === "slyDeal")!,
    s = group(property("yellow"), "friend-set");
  g.players[0].hand = [sly];
  g.players[1].sets = [s];
  const intent = dropIntent(view(g, "me"), sly.id, false, {
    zone: "group",
    owner: "friend",
    setId: s.id,
    cardId: s.cards[0].id,
  });
  assert.ok("prompt" in intent);
  assert.equal(intent.prompt.target, "friend");
  assert.equal(intent.prompt.targetCard, s.cards[0].id);
});
test("saved games upgrade card names and INR logs without changing cards or seats", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dealz-bihar-"));
  try {
    const g = setup();
    g.players[0].hand = [{ ...property("brown"), name: "Brown property" }];
    g.log = ["me banked 2M"];
    const store = new Store(dir);
    store.save({ game: g, seen: {} });
    const restored = new Store(dir).rooms.get(g.code)!.game;
    assert.equal(restored.players[0].hand[0].name, "Manopali");
    assert.equal(restored.players[0].hand[0].id, g.players[0].hand[0].id);
    assert.equal(restored.log[0], "me banked ₹2 cr");
    assert.equal(restored.players[0].token, g.players[0].token);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
