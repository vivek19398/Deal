import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { io, type Socket } from "socket.io-client";
import type { ChatMessage, ChatReply } from "../shared/chat.js";
import type { Command, Reply, Session, View } from "../shared/model.js";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
test(
  "real sockets: room privacy, stale/duplicate commands, reconnect and process recovery",
  { timeout: 30000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dealz-network-"));
    const port = randomInt(20000, 40000),
      url = `http://127.0.0.1:${port}`;
    let child: ChildProcess | undefined;
    const sockets: Socket[] = [];
    let output = "";
    let firstLaunch = true;
    async function launch() {
      child = spawn(
        firstLaunch ? "./start.sh" : process.execPath,
        firstLaunch
          ? []
          : ["--import", "tsx", "server/index.ts", "--production"],
        {
          env: {
            ...process.env,
            PORT: String(port),
            PATH:
              path.dirname(process.execPath) +
              path.delimiter +
              process.env.PATH,
            DATA_DIR: dir,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      firstLaunch = false;
      child.stdout?.on("data", (b) => (output += b));
      child.stderr?.on("data", (b) => (output += b));
      for (let i = 0; i < 200; i++) {
        try {
          if ((await fetch(url + "/api/health")).ok) return;
        } catch {}
        if (child.exitCode !== null) throw Error(output);
        await wait(50);
      }
      throw Error("Server startup timeout: " + output);
    }
    async function stop() {
      if (!child || child.exitCode !== null) return;
      await new Promise<void>((resolve) => {
        child!.once("exit", () => resolve());
        child!.kill();
      });
    }
    async function client() {
      const socket = io(url, {
        transports: ["websocket"],
        reconnection: false,
        forceNew: true,
      });
      sockets.push(socket);
      let state: View | undefined;
      let history: ChatMessage[] = [];
      const received: ChatMessage[] = [];
      socket.on(
        "chat:history",
        (messages: ChatMessage[]) => (history = messages),
      );
      socket.on("chat:message", (message: ChatMessage) =>
        received.push(message),
      );
      socket.on("state", (s) => (state = s));
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
      });
      return {
        socket,
        received,
        get history() {
          return history;
        },
        get state() {
          assert.ok(state);
          return state;
        },
        async enter(a: object) {
          const r = (await socket
            .timeout(3000)
            .emitWithAck("enter", a)) as Reply;
          assert.ifError(r.error);
          await wait(10);
          return r.session!;
        },
        async command(
          command: Command,
          id = randomUUID(),
          version = state!.version,
        ) {
          const r = (await socket
            .timeout(3000)
            .emitWithAck("command", { id, version, command })) as Reply;
          await wait(10);
          return r;
        },
      };
    }
    try {
      await launch();
      const a = await client(),
        b = await client();
      const sa = await a.enter({ create: true, name: "Alpha" });
      const sb = await b.enter({ code: sa.code, name: "Bravo" });
      assert.equal(a.state.players.length, 2);
      const outsider = await client();
      await outsider.enter({ create: true, name: "Other table" });
      const unauthenticated = await client();
      const rejected = await unauthenticated.socket
        .timeout(3000)
        .emitWithAck("chat:send", { clientId: "not-seated", text: "Hello" });
      assert.match(rejected.error, /Join/);
      const versionBeforeChat = a.state.version;
      const chatInput = {
        clientId: "chat-1",
        text: "Namaste from Bihar 🙏",
        senderName: "Forged sender",
      };
      const chatReply = (await a.socket
        .timeout(3000)
        .emitWithAck("chat:send", chatInput)) as ChatReply;
      assert.ifError(chatReply.error);
      await wait(20);
      assert.equal(chatReply.message?.senderName, "Alpha");
      assert.equal(b.received[0].text, chatInput.text);
      assert.equal(outsider.received.length, 0);
      assert.equal(a.state.version, versionBeforeChat);
      await a.socket.timeout(3000).emitWithAck("chat:send", chatInput);
      await wait(10);
      assert.equal(b.received.length, 1);

      assert.ifError((await a.command({ type: "ready", ready: true })).error);
      assert.ifError((await b.command({ type: "ready", ready: true })).error);
      assert.ifError((await a.command({ type: "start" })).error);
      assert.equal(
        a.state.players.find((p) => p.id === sa.playerId)?.hand?.length,
        7,
      );
      assert.equal(
        b.state.players.find((p) => p.id === sa.playerId)?.hand,
        undefined,
      );
      assert.ok(!JSON.stringify(b.state).includes(sa.token));
      const attacker = await client();
      const denied = await attacker.socket.timeout(3000).emitWithAck("enter", {
        code: sa.code,
        playerId: sa.playerId,
        token: "wrong",
      });
      assert.match(denied.error, /restored/);
      const money = a.state.players
        .find((p) => p.id === sa.playerId)!
        .hand!.find(
          (c) => c.kind === "money" || c.kind === "action" || c.kind === "rent",
        );
      assert.ok(money);
      const v = a.state.version;
      const duplicateId = randomUUID();
      assert.ifError(
        (
          await a.command(
            { type: "play", cardId: money.id, mode: "bank" },
            duplicateId,
            v,
          )
        ).error,
      );
      assert.ifError(
        (
          await a.command(
            { type: "play", cardId: money.id, mode: "bank" },
            duplicateId,
            v,
          )
        ).error,
      );
      assert.equal(a.state.plays, 1);
      assert.match(
        (await a.command({ type: "end" }, randomUUID(), v)).error!,
        /changed/,
      );
      const simultaneous = await Promise.all([
        a.command({ type: "end" }),
        a.command({ type: "end" }),
      ]);
      assert.equal(simultaneous.filter((r) => !r.error).length, 1);
      assert.equal(a.state.turn, 1);
      b.socket.disconnect();
      await wait(40);
      assert.equal(a.state.paused, true);
      const b2 = await client();
      await b2.enter(sb);
      assert.ifError((await a.command({ type: "resume" })).error);
      assert.equal(a.state.paused, false);
      const savedBank = a.state.players[0].bank.map((c) => c.id);
      const savedHand = b2.state.players
        .find((p) => p.id === sb.playerId)!
        .hand!.map((c) => c.id);
      for (const s of sockets) s.disconnect();
      await wait(30);
      await stop();
      await launch();
      const a2 = await client(),
        b3 = await client();
      await a2.enter(sa);
      await b3.enter(sb);
      assert.equal(a2.state.paused, true);
      assert.deepEqual(
        a2.state.players[0].bank.map((c) => c.id),
        savedBank,
      );
      assert.deepEqual(
        b3.state.players
          .find((p) => p.id === sb.playerId)!
          .hand!.map((c) => c.id),
        savedHand,
      );
      assert.equal(a2.history[0].text, "Namaste from Bihar 🙏");
      assert.equal(b3.history[0].id, a2.history[0].id);
      assert.ifError((await a2.command({ type: "resume" })).error);
      assert.ifError((await a2.command({ type: "endGame" })).error);
      assert.ifError((await a2.command({ type: "rematch" })).error);
      assert.equal(a2.state.status, "lobby");
      assert.ok(a2.state.players.every((p) => p.handCount === 0));
      const qr = await fetch(url + `/api/qr?room=${sa.code}`);
      assert.equal(
        qr.headers.get("content-type")?.includes("image/svg+xml"),
        true,
      );
      assert.match(await qr.text(), /<svg/);
    } finally {
      for (const s of sockets) s.disconnect();
      await stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
