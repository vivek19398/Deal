import fs from "node:fs";
import { randomInt, randomUUID } from "node:crypto";
import path from "node:path";
import {
  CHAT_LIMIT,
  CHAT_HISTORY,
  type ChatMessage,
  type ChatInput,
} from "../shared/chat.js";
import type { Game, Envelope } from "../shared/model.js";
import { makeDeck } from "../shared/deck.js";
import { apply } from "../shared/engine.js";
export interface RecordRoom {
  game: Game;
  seen: Record<string, string[]>;
  chat?: ChatMessage[];
}
export class Store {
  rooms = new Map<string, RecordRoom>();
  private chatTimes = new Map<string, number[]>();
  constructor(public directory: string) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const f of fs
      .readdirSync(directory)
      .filter((f) => f.endsWith(".json"))) {
      try {
        const r = JSON.parse(
          fs.readFileSync(path.join(directory, f), "utf8"),
        ) as RecordRoom;
        // Keep existing seats and card IDs while upgrading saved decks to Bihar names.
        const themed = new Map(makeDeck().map((c) => [c.id, c]));
        for (const c of [
          ...r.game.deck,
          ...r.game.discard,
          ...r.game.players.flatMap((p) => [
            ...p.hand,
            ...p.bank,
            ...p.sets.flatMap((s) => [...s.cards, ...s.buildings]),
          ]),
        ]) {
          const current = themed.get(c.id);
          if (current && current.kind === c.kind) c.name = current.name;
        }
        r.game.log = r.game.log.map((line) =>
          line.replace(/(\d+)M\b/g, "₹$1 cr"),
        );
        for (const p of r.game.players) p.connected = false;
        if (r.game.status === "playing") r.game.paused = true;
        this.rooms.set(r.game.code, r);
      } catch {
        console.error(`Could not read saved room ${f}; original file retained`);
      }
    }
  }
  save(r: RecordRoom) {
    const file = path.join(this.directory, `${r.game.code}.json`);
    fs.writeFileSync(file + ".tmp", JSON.stringify(r), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
    this.rooms.set(r.game.code, r);
  }
  addChat(code: string, playerId: string, input: ChatInput, now = Date.now()) {
    const room = this.rooms.get(code);
    const player = room?.game.players.find((p) => p.id === playerId);
    if (!room || !player)
      throw Error("Join this table before sending a message");
    if (
      !input ||
      typeof input.clientId !== "string" ||
      !input.clientId ||
      input.clientId.length > 100 ||
      typeof input.text !== "string"
    )
      throw Error("Invalid chat message");
    const existing = room.chat?.find(
      (m) => m.senderId === playerId && m.clientId === input.clientId,
    );
    if (existing) return { message: existing, duplicate: true };
    if (input.text.length > CHAT_LIMIT)
      throw Error(`Keep messages within ${CHAT_LIMIT} characters`);
    const text = input.text
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      .trim();
    if (!text) throw Error("Write a message first");
    const key = code + ":" + playerId;
    const times = (this.chatTimes.get(key) || []).filter((t) => now - t < 5000);
    if (times.length >= 5)
      throw Error("A little slower — try again in a few seconds");
    const message: ChatMessage = {
      id: randomUUID(),
      clientId: input.clientId,
      senderId: player.id,
      senderName: player.name,
      text,
      createdAt: now,
    };
    this.save({
      ...room,
      chat: [...(room.chat || []), message].slice(-CHAT_HISTORY),
    });
    this.chatTimes.set(key, [...times, now]);
    return { message, duplicate: false };
  }
  command(code: string, id: string, e: Envelope) {
    const r = this.rooms.get(code);
    if (!r) throw Error("Room not found");
    if (!e || typeof e.id !== "string" || e.id.length > 100 || !e.command)
      throw Error("Invalid command");
    if (r.seen[id]?.includes(e.id)) return r;
    if (e.version !== r.game.version)
      throw Error("The table changed. Please try again.");
    const game = apply(
      r.game,
      id,
      e.command,
      () => randomInt(0, 0x100000000) / 0x100000000,
    );
    if (
      game.status === "playing" &&
      (!game.players[game.turn].connected ||
        (game.pending &&
          !game.players.find((p) => p.id === game.pending!.responder)
            ?.connected))
    )
      game.paused = true;
    game.version++;
    const next = {
      ...r,
      game,
      seen: { ...r.seen, [id]: [...(r.seen[id] || []), e.id].slice(-200) },
    };
    this.save(next);
    return next;
  }
}
