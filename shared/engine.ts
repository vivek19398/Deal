import { money } from "./theme.js";
import { makeDeck, shuffle } from "./deck.js";
import {
  groups,
  colors,
  type Card,
  type Color,
  type Command,
  type Effect,
  type Game,
  type Player,
  type SetGroup,
  type View,
} from "./model.js";
const assert: (condition: unknown, message: string) => asserts condition = (
  c,
  m,
) => {
  if (!c) throw Error(m);
};
export const complete = (s: SetGroup) =>
  s.cards.length === groups[s.color].size &&
  s.cards.some((c) => c.kind === "property" || c.value > 0);
export function rent(s: SetGroup) {
  return (
    groups[s.color].rent[Math.min(s.cards.length, groups[s.color].size) - 1] +
    s.buildings.reduce((n, c) => n + (c.action === "house" ? 3 : 4), 0)
  );
}
export function view(g: Game, id: string): View {
  const { deck, players, ...rest } = g;
  return {
    ...rest,
    deckCount: deck.length,
    you: id,
    players: players.map(({ token, hand, ...p }) => ({
      ...p,
      handCount: hand.length,
      ...(p.id === id ? { hand } : {}),
    })),
  };
}
function log(g: Game, s: string) {
  g.log = [s, ...g.log].slice(0, 60);
}
function draw(g: Game, p: Player, n: number, random: () => number) {
  for (let i = 0; i < n; i++) {
    if (!g.deck.length) {
      g.deck = shuffle(g.discard, random);
      g.discard = [];
    }
    const c = g.deck.pop();
    if (c) p.hand.push(c);
  }
}
function take(a: Card[], id: string) {
  const i = a.findIndex((c) => c.id === id);
  assert(i >= 0, "Card not found");
  return a.splice(i, 1)[0];
}
function getPlayer(g: Game, id: string) {
  const p = g.players.find((p) => p.id === id);
  assert(p, "Player not found");
  return p;
}
function getSet(p: Player, id?: string) {
  const s = p.sets.find((s) => s.id === id);
  assert(s, "Choose a property group");
  return s;
}
function findProperty(p: Player, id?: string) {
  const s = p.sets.find((s) => s.cards.some((c) => c.id === id));
  assert(s, "Choose a property");
  return { s, c: s.cards.find((c) => c.id === id)! };
}
function tidy(p: Player) {
  for (const s of p.sets) {
    if (!complete(s) && s.buildings.length) {
      p.bank.push(...s.buildings);
      s.buildings = [];
    }
  }
  p.sets = p.sets.filter((s) => s.cards.length);
}
function place(p: Player, c: Card, color: Color, setId?: string) {
  assert(c.colors?.includes(color), "Choose an allowed colour");
  let s =
    setId && setId !== "new"
      ? p.sets.find((s) => s.id === setId)
      : setId === "new"
        ? undefined
        : p.sets.find(
            (s) => s.color === color && s.cards.length < groups[color].size,
          );
  if (setId && setId !== "new")
    assert(s && s.color === color, "Invalid destination group");
  if (!s) {
    let groupId = `set-${c.id}`;
    while (p.sets.some((s) => s.id === groupId)) groupId += "-new";
    s = { id: groupId, color, cards: [], buildings: [] };
    p.sets.push(s);
  }
  assert(s.cards.length < groups[color].size, "That group is full");
  s.cards.push(c);
}
function won(g: Game) {
  for (const p of g.players) {
    if (new Set(p.sets.filter(complete).map((s) => s.color)).size >= 3) {
      g.status = "finished";
      g.winner = p.id;
      g.pending = undefined;
      log(g, `${p.name} completed three different sets and wins!`);
      return;
    }
  }
}
function beginTurn(g: Game, random: () => number) {
  g.plays = 0;
  const p = g.players[g.turn];
  draw(g, p, p.hand.length ? 2 : 5, random);
  g.paused = !p.connected;
  log(g, `${p.name}'s turn`);
}
function nextEffect(g: Game, effects: Effect[]) {
  won(g);
  if (g.status === "finished") return;
  const effect = effects.shift();
  if (!effect) {
    g.pending = undefined;
    won(g);
    return;
  }
  g.pending = {
    effects,
    effect,
    stage: "response",
    responder: effect.target,
    cancelled: false,
  };
}
function resolve(g: Game) {
  const pending = g.pending!;
  const e = pending.effect;
  const actor = getPlayer(g, e.actor),
    target = getPlayer(g, e.target);
  if (!pending.cancelled) {
    if (e.kind === "payment") {
      pending.stage = "payment";
      pending.responder = e.target;
      return;
    }
    if (e.kind === "breaker") {
      const s = getSet(target, e.setId);
      target.sets = target.sets.filter((x) => x !== s);
      while (actor.sets.some((group) => group.id === s.id)) s.id += "-taken";
      actor.sets.push(s);
    } else {
      const { s, c } = findProperty(target, e.cardId);
      take(s.cards, c.id);
      place(actor, c, s.color);
      if (e.kind === "forced") {
        const give = findProperty(actor, e.giveId);
        take(give.s.cards, give.c.id);
        place(target, give.c, give.s.color);
      }
      tidy(target);
      tidy(actor);
    }
    log(g, `${actor.name}'s action resolved against ${target.name}`);
  } else log(g, `${target.name} blocked the action`);
  nextEffect(g, pending.effects);
}
export function apply(
  original: Game,
  id: string,
  cmd: Command,
  random: () => number = Math.random,
): Game {
  const g = structuredClone(original);
  const p = getPlayer(g, id);
  const owner = () => assert(g.owner === id, "Only the room owner can do that");
  if (cmd.type === "endGame") {
    owner();
    assert(g.status === "playing", "No active game");
    g.status = "finished";
    g.pending = undefined;
    log(g, "The owner ended the game");
    return g;
  }
  if (cmd.type === "rematch") {
    owner();
    assert(g.status === "finished", "Finish the game first");
    g.status = "lobby";
    g.winner = undefined;
    g.pending = undefined;
    g.paused = false;
    for (const q of g.players) {
      q.ready = false;
      q.hand = [];
      q.bank = [];
      q.sets = [];
    }
    g.deck = [];
    g.discard = [];
    log(g, "Ready for a rematch");
    return g;
  }
  if (cmd.type === "resume") {
    owner();
    assert(g.status === "playing", "No active game");
    assert(
      g.players[g.turn].connected &&
        (!g.pending || getPlayer(g, g.pending.responder).connected),
      "Waiting for a required player to reconnect",
    );
    g.paused = false;
    return g;
  }
  if (cmd.type === "leave") {
    assert(g.status === "lobby", "Seats are reserved until the game ends");
    g.players = g.players.filter((q) => q.id !== id);
    if (g.owner === id && g.players.length) g.owner = g.players[0].id;
    return g;
  }
  if (g.status === "lobby") {
    if (cmd.type === "kick") {
      owner();
      const target = getPlayer(g, cmd.playerId);
      assert(
        !target.connected && target.id !== id,
        "Only disconnected seats can be removed",
      );
      g.players = g.players.filter((q) => q.id !== target.id);
      return g;
    }
    if (cmd.type === "ready") {
      assert(typeof cmd.ready === "boolean", "Ready must be true or false");
      p.ready = cmd.ready;
      return g;
    }
    if (cmd.type === "seat") {
      assert(
        Number.isInteger(cmd.seat) &&
          cmd.seat >= 0 &&
          cmd.seat < g.players.length,
        "Invalid seat",
      );
      const old = g.players.indexOf(p);
      [g.players[old], g.players[cmd.seat]] = [g.players[cmd.seat], p];
      return g;
    }
    assert(cmd.type === "start", "Game has not started");
    owner();
    assert(
      g.players.length >= 2 && g.players.every((q) => q.ready && q.connected),
      "Need 2–5 connected, ready players",
    );
    g.deck = shuffle(makeDeck(), random);
    g.discard = [];
    for (const q of g.players) {
      q.hand = [];
      q.bank = [];
      q.sets = [];
      draw(g, q, 5, random);
    }
    g.status = "playing";
    g.turn = 0;
    beginTurn(g, random);
    return g;
  }
  assert(g.status === "playing", "Game has ended");
  assert(
    !g.paused,
    "Game paused: wait for reconnect, then the owner can resume",
  );
  if (g.pending) {
    const pending = g.pending;
    assert(pending.responder === id, "Waiting for another player");
    if (cmd.type === "respond") {
      assert(pending.stage === "response", "Choose your payment");
      if (cmd.no) {
        const c = p.hand.find((c) => c.action === "no");
        assert(c, "No Just Say No card in your hand");
        g.discard.push(take(p.hand, c.id));
        pending.cancelled = !pending.cancelled;
        pending.responder =
          id === pending.effect.actor
            ? pending.effect.target
            : pending.effect.actor;
        log(g, `${p.name} played Just Say No`);
      } else resolve(g);
      return g;
    }
    assert(
      cmd.type === "pay" && pending.stage === "payment",
      "Respond to the action first",
    );
    assert(new Set(cmd.cardIds).size === cmd.cardIds.length, "Duplicate cards");
    const assets = [
      ...p.bank,
      ...p.sets.flatMap((s) => [...s.cards, ...s.buildings]),
    ].filter((c) => c.value > 0);
    const selected = cmd.cardIds.map((id) => {
      const c = assets.find((c) => c.id === id);
      assert(c, "Invalid payment card");
      return c;
    });
    const total = selected.reduce((n, c) => n + c.value, 0),
      owed = pending.effect.amount!;
    assert(
      total >= owed || selected.length === assets.length,
      "Pay enough, or all your assets",
    );
    const receiver = getPlayer(g, pending.effect.actor);
    for (const c of selected) {
      if (p.bank.some((x) => x.id === c.id))
        receiver.bank.push(take(p.bank, c.id));
      else {
        const s = p.sets.find(
          (s) =>
            s.cards.some((x) => x.id === c.id) ||
            s.buildings.some((x) => x.id === c.id),
        )!;
        if (s.cards.some((x) => x.id === c.id)) {
          take(s.cards, c.id);
          place(receiver, c, s.color);
        } else receiver.bank.push(take(s.buildings, c.id));
      }
    }
    tidy(p);
    log(g, `${p.name} paid ${receiver.name} ${money(total)}`);
    nextEffect(g, pending.effects);
    return g;
  }
  assert(g.players[g.turn].id === id, "It is not your turn");
  if (cmd.type === "discard") {
    assert(p.hand.length > 7, "No need to discard");
    assert(
      new Set(cmd.cardIds).size === cmd.cardIds.length &&
        cmd.cardIds.length === p.hand.length - 7,
      "Discard down to seven cards",
    );
    for (const cid of cmd.cardIds) g.discard.push(take(p.hand, cid));
    g.turn = (g.turn + 1) % g.players.length;
    beginTurn(g, random);
    return g;
  }
  if (cmd.type === "end") {
    assert(p.hand.length <= 7, "Discard down to seven first");
    g.turn = (g.turn + 1) % g.players.length;
    beginTurn(g, random);
    return g;
  }
  if (cmd.type === "moveBuilding") {
    const source = p.sets.find((s) =>
      s.buildings.some((c) => c.id === cmd.cardId),
    );
    assert(source, "Choose one of your buildings");
    const c = source.buildings.find((c) => c.id === cmd.cardId)!;
    const destination = getSet(p, cmd.setId);
    assert(
      destination !== source &&
        complete(destination) &&
        !["railroad", "utility"].includes(destination.color),
      "Choose another complete coloured set",
    );
    assert(
      !destination.buildings.some((x) => x.action === c.action),
      "Destination already has that building",
    );
    if (c.action === "house")
      assert(
        !source.buildings.some((x) => x.action === "hotel"),
        "Move the hotel before the house",
      );
    if (c.action === "hotel")
      assert(
        destination.buildings.some((x) => x.action === "house"),
        "Destination needs a house",
      );
    destination.buildings.push(take(source.buildings, c.id));
    return g;
  }
  if (cmd.type === "move") {
    const { s, c } = findProperty(p, cmd.cardId);
    assert(
      c.kind === "wild" || c.kind === "property",
      "Only properties can move",
    );
    assert(
      !s.buildings.length,
      "Move the buildings to another complete set before moving this property",
    );
    take(s.cards, c.id);
    p.sets = p.sets.filter((x) => x.cards.length);
    place(p, c, cmd.color, cmd.setId);
    won(g);
    return g;
  }
  assert(cmd.type === "play", "Invalid command");
  assert(g.plays < 3, "You have used all three plays");
  const c = p.hand.find((c) => c.id === cmd.cardId);
  assert(c, "Card not in your hand");
  if (cmd.mode === "bank") {
    assert(
      c.kind !== "property" && c.kind !== "wild",
      "Properties cannot be banked",
    );
    p.bank.push(take(p.hand, c.id));
    g.plays++;
    log(g, `${p.name} banked ${money(c.value)}`);
    return g;
  }
  if (c.kind === "property" || c.kind === "wild") {
    assert(cmd.color, "Choose a colour");
    place(p, take(p.hand, c.id), cmd.color, cmd.setId);
    g.plays++;
    log(g, `${p.name} added a property`);
    won(g);
    return g;
  }
  assert(c.kind !== "money", "Money must be banked");
  const effects: Effect[] = [];
  if (c.kind === "rent") {
    const s = getSet(p, cmd.setId);
    assert(c.colors?.includes(s.color), "Rent card does not match this colour");
    const doubles = cmd.doubleIds || [];
    assert(
      new Set(doubles).size === doubles.length &&
        g.plays + 1 + doubles.length <= 3,
      "Not enough plays for those doubles",
    );
    for (const cid of doubles) {
      assert(
        p.hand.find((x) => x.id === cid)?.action === "double",
        "Choose Double the Rent cards",
      );
      g.discard.push(take(p.hand, cid));
    }
    g.plays += doubles.length;
    const targets =
      c.colors!.length === 10
        ? [getPlayer(g, cmd.target || "")]
        : g.players.filter((q) => q.id !== id);
    for (const t of targets) {
      assert(t.id !== id, "Choose an opponent");
      effects.push({
        actor: id,
        target: t.id,
        kind: "payment",
        amount: rent(s) * 2 ** doubles.length,
      });
    }
  } else
    switch (c.action) {
      case "passGo":
        draw(g, p, 2, random);
        break;
      case "house":
      case "hotel": {
        const s = getSet(p, cmd.setId);
        assert(
          complete(s) && !["railroad", "utility"].includes(s.color),
          "Buildings need a complete coloured set",
        );
        assert(
          !s.buildings.some((x) => x.action === c.action),
          "This building is already present",
        );
        if (c.action === "hotel")
          assert(
            s.buildings.some((x) => x.action === "house"),
            "Build a house before a hotel",
          );
        s.buildings.push(take(p.hand, c.id));
        g.plays++;
        log(g, `${p.name} built a ${c.action}`);
        return g;
      }
      case "birthday":
        for (const t of g.players.filter((q) => q.id !== id))
          effects.push({ actor: id, target: t.id, kind: "payment", amount: 2 });
        break;
      case "debt": {
        const t = getPlayer(g, cmd.target || "");
        assert(t.id !== id, "Choose an opponent");
        effects.push({ actor: id, target: t.id, kind: "payment", amount: 5 });
        break;
      }
      case "slyDeal":
      case "forcedDeal":
      case "dealBreaker": {
        const t = getPlayer(g, cmd.target || "");
        assert(t.id !== id, "Choose an opponent");
        if (c.action === "dealBreaker") {
          const s = getSet(t, cmd.targetSet);
          assert(complete(s), "Choose a complete set");
          effects.push({
            actor: id,
            target: t.id,
            kind: "breaker",
            setId: s.id,
          });
        } else {
          const { s } = findProperty(t, cmd.targetCard);
          assert(!complete(s), "Cannot take a card from a complete set");
          if (c.action === "forcedDeal") {
            const give = findProperty(p, cmd.giveCard);
            assert(!complete(give.s), "Cannot trade from your complete set");
          }
          effects.push({
            actor: id,
            target: t.id,
            kind: c.action === "slyDeal" ? "sly" : "forced",
            cardId: cmd.targetCard,
            giveId: cmd.giveCard,
          });
        }
        break;
      }
      default:
        throw Error("Use this card as a response, with rent, or bank it");
    }
  g.discard.push(take(p.hand, c.id));
  g.plays++;
  log(g, `${p.name} played ${c.name}`);
  if (effects.length) nextEffect(g, effects);
  won(g);
  return g;
}
