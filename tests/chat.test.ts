import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.js";
import type { Game } from "../shared/model.js";
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dealz-chat-"));
  const store = new Store(dir);
  const game: Game = {
    code: "CHAT22",
    owner: "a",
    players: [
      {
        id: "a",
        name: "Anjali",
        token: "secret",
        connected: true,
        ready: false,
        hand: [],
        bank: [],
        sets: [],
      },
    ],
    status: "lobby",
    version: 5,
    turn: 0,
    plays: 0,
    deck: [],
    discard: [],
    paused: false,
    log: [],
  };
  store.save({ game, seen: {} });
  return {
    store,
    dir,
    close: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
test("chat validates membership, length and blank messages", () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        f.store.addChat("CHAT22", "stranger", { clientId: "one", text: "Hi" }),
      /Join/,
    );
    assert.throws(
      () =>
        f.store.addChat("CHAT22", "a", {
          clientId: "one",
          text: "x".repeat(281),
        }),
      /280/,
    );
    assert.throws(
      () => f.store.addChat("CHAT22", "a", { clientId: "one", text: " \n\t " }),
      /Write/,
    );
    assert.throws(
      () => f.store.addChat("CHAT22", "a", { clientId: "", text: "Hi" }),
      /Invalid/,
    );
    assert.equal(f.store.rooms.get("CHAT22")?.chat?.length || 0, 0);
  } finally {
    f.close();
  }
});
test("chat trusts server identity, retains Unicode, strips controls and leaves game version unchanged", () => {
  const f = fixture();
  try {
    const result = f.store.addChat(
      "CHAT22",
      "a",
      { clientId: "one", text: "  नमस्ते 🙏\u0000\nBadiya deal!  " },
      1000,
    );
    assert.equal(result.message.senderName, "Anjali");
    assert.equal(result.message.text, "नमस्ते 🙏\nBadiya deal!");
    assert.equal(result.message.createdAt, 1000);
    assert.equal(f.store.rooms.get("CHAT22")!.game.version, 5);
    assert.ok(!JSON.stringify(result.message).includes("secret"));
  } finally {
    f.close();
  }
});
test("retry is idempotent and message rate limiting applies per player", () => {
  const f = fixture();
  try {
    const first = f.store.addChat(
      "CHAT22",
      "a",
      { clientId: "one", text: "Hi" },
      1000,
    );
    for (let i = 0; i < 5; i++)
      assert.equal(
        f.store.addChat("CHAT22", "a", { clientId: "one", text: "Hi" }, 1000)
          .message.id,
        first.message.id,
      );
    for (let i = 0; i < 4; i++)
      f.store.addChat(
        "CHAT22",
        "a",
        { clientId: "more-" + i, text: "Another message" },
        1000,
      );
    assert.throws(
      () =>
        f.store.addChat(
          "CHAT22",
          "a",
          { clientId: "too-fast", text: "Too fast" },
          1000,
        ),
      /slower/,
    );
    assert.equal(f.store.rooms.get("CHAT22")!.chat!.length, 5);
    f.store.addChat("CHAT22", "a", { clientId: "later", text: "Later" }, 6001);
    assert.equal(f.store.rooms.get("CHAT22")!.chat!.length, 6);
  } finally {
    f.close();
  }
});
test("latest 100 messages survive game commands and process recovery", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 105; i++)
      f.store.addChat(
        "CHAT22",
        "a",
        { clientId: "message-" + i, text: "Message " + i },
        i * 6000,
      );
    assert.equal(f.store.rooms.get("CHAT22")!.chat!.length, 100);
    assert.equal(f.store.rooms.get("CHAT22")!.chat![0].text, "Message 5");
    f.store.command("CHAT22", "a", {
      id: "ready",
      version: 5,
      command: { type: "ready", ready: true },
    });
    assert.equal(f.store.rooms.get("CHAT22")!.chat!.length, 100);
    const recovered = new Store(f.dir).rooms.get("CHAT22")!;
    assert.equal(recovered.chat!.at(-1)!.text, "Message 104");
    assert.equal(recovered.game.players[0].ready, true);
  } finally {
    f.close();
  }
});
