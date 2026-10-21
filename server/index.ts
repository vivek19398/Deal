import express from "express";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { randomBytes, randomUUID, randomInt } from "node:crypto";
import path from "node:path";
import { Server } from "socket.io";
import QRCode from "qrcode";
import { Store } from "./store.js";
import { view } from "../shared/engine.js";
import type { ChatInput } from "../shared/chat.js";
import type { Envelope, Session } from "../shared/model.js";
import gameHandler from "../api/game.js";
const cloudMode = process.argv.includes("--online");
const app = express(),
  http = createServer(app),
  io = new Server(http, { maxHttpBufferSize: 20_000 });
if (cloudMode)
  app.post(
    "/api/game",
    express.json({ limit: "16kb" }),
    (req, res) => void gameHandler(req, res),
  );
const store = new Store(process.env.DATA_DIR || path.resolve(".data"));
const port = Number(process.env.PORT || 3000);
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((x) => x && x.family === "IPv4" && !x.internal)
  .map((x) => `http://${x!.address}:${port}`);
app.get("/api/host", (_req, res) => res.json({ addresses, port }));
app.get("/api/qr", async (req, res) => {
  const host = addresses[0] || `http://localhost:${port}`;
  const code =
    typeof req.query.room === "string" && /^[A-Z2-9]{6}$/.test(req.query.room)
      ? req.query.room
      : "";
  res.type("svg").send(
    await QRCode.toString(host + (code ? `/?room=${code}` : ""), {
      type: "svg",
      margin: 2,
      color: { dark: "#123e36", light: "#ffffff" },
    }),
  );
});
app.get("/api/health", (_req, res) => res.json({ ok: true }));
const online = new Map<string, Set<string>>();
function broadcast(code: string) {
  const r = store.rooms.get(code);
  if (!r) return;
  for (const socket of io.sockets.sockets.values()) {
    const s = socket.data.session as Session | undefined;
    if (s?.code === code) socket.emit("state", view(r.game, s.playerId));
  }
}
function nickname(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 24)
    throw Error("Use a nickname of 1–24 characters");
  return value.trim();
}
// All commands and persistence are synchronous: each room transition is atomic within this process.
io.on("connection", (socket) => {
  let count = 0,
    windowStart = Date.now();
  socket.use((_packet, next) => {
    if (Date.now() - windowStart > 10000) {
      windowStart = Date.now();
      count = 0;
    }
    next(++count > 100 ? Error("Too many requests") : undefined);
  });
  function attach(session: Session) {
    socket.data.session = session;
    const key = session.code + ":" + session.playerId;
    const set = online.get(key) || new Set<string>();
    set.add(socket.id);
    online.set(key, set);
  }
  socket.on("enter", (input: unknown, ack: unknown) => {
    if (typeof ack !== "function") return;
    try {
      if (socket.data.session)
        throw Error("Already seated; reload to change rooms");
      const a = input as {
        create?: boolean;
        code?: string;
        name?: string;
        token?: string;
        playerId?: string;
      };
      if (!a || typeof a !== "object") throw Error("Invalid request");
      let code = String(a.code || "").toUpperCase();
      let r = store.rooms.get(code);
      let p;
      if (a.create) {
        if (store.rooms.size >= 500)
          throw Error("Host room limit reached; remove old saved rooms");
        do {
          code = Array.from(
            { length: 6 },
            () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)],
          ).join("");
        } while (store.rooms.has(code));
        const name = nickname(a.name);
        p = {
          id: randomUUID(),
          token: randomBytes(24).toString("hex"),
          name,
          connected: true,
          ready: false,
          hand: [],
          bank: [],
          sets: [],
        };
        r = {
          game: {
            code,
            owner: p.id,
            players: [p],
            status: "lobby",
            version: 0,
            turn: 0,
            plays: 0,
            deck: [],
            discard: [],
            paused: false,
            log: ["A new table is open"],
          },
          seen: {},
        };
      } else {
        if (!r) throw Error("Room not found");
        if (a.token) {
          p = r.game.players.find(
            (p) => p.id === a.playerId && p.token === a.token,
          );
          if (!p) throw Error("This seat could not be restored");
          p.connected = true;
        } else {
          if (r.game.status !== "lobby")
            throw Error("This game has already started");
          if (r.game.players.length >= 5) throw Error("This table is full");
          const name = nickname(a.name);
          if (
            r.game.players.some(
              (p) => p.name.toLowerCase() === name.toLowerCase(),
            )
          )
            throw Error("That nickname is already at the table");
          p = {
            id: randomUUID(),
            token: randomBytes(24).toString("hex"),
            name,
            connected: true,
            ready: false,
            hand: [],
            bank: [],
            sets: [],
          };
          r.game.players.push(p);
        }
      }
      r!.game.version++;
      store.save(r!);
      const session = { code, playerId: p!.id, token: p!.token };
      attach(session);
      ack({ session });
      broadcast(code);
      socket.emit("chat:history", r!.chat || []);
    } catch (e) {
      ack({ error: (e as Error).message });
    }
  });
  socket.on("command", (e: Envelope, ack: unknown) => {
    if (typeof ack !== "function") return;
    const s = socket.data.session as Session | undefined;
    try {
      if (!s) throw Error("Join a room first");
      const r = store.command(s.code, s.playerId, e);
      if (e.command.type === "leave") {
        const key = s.code + ":" + s.playerId;
        for (const sid of online.get(key) || []) {
          const other = io.sockets.sockets.get(sid);
          if (other) {
            other.data.session = undefined;
            other.emit("left");
          }
        }
        online.delete(key);
      }
      ack({});
      broadcast(r.game.code);
    } catch (e) {
      ack({ error: (e as Error).message });
      if (s) broadcast(s.code);
    }
  });
  socket.on("chat:send", (input: ChatInput, ack: unknown) => {
    if (typeof ack !== "function") return;
    try {
      const session = socket.data.session as Session | undefined;
      if (!session) throw Error("Join a table first");
      const result = store.addChat(session.code, session.playerId, input);
      if (!result.duplicate)
        for (const peer of io.sockets.sockets.values()) {
          const target = peer.data.session as Session | undefined;
          if (
            target?.code === session.code &&
            store.rooms
              .get(target.code)
              ?.game.players.some((p) => p.id === target.playerId)
          )
            peer.emit("chat:message", result.message);
        }
      ack({ message: result.message });
    } catch (error) {
      ack({ error: (error as Error).message });
    }
  });
  socket.on("disconnect", () => {
    const s = socket.data.session as Session | undefined;
    if (!s) return;
    const key = s.code + ":" + s.playerId;
    online.get(key)?.delete(socket.id);
    if (online.get(key)?.size) return;
    online.delete(key);
    const r = store.rooms.get(s.code),
      p = r?.game.players.find((p) => p.id === s.playerId);
    if (!r || !p) return;
    p.connected = false;
    p.ready = false;
    if (
      r.game.status === "playing" &&
      (r.game.players[r.game.turn].id === p.id ||
        r.game.pending?.responder === p.id)
    )
      r.game.paused = true;
    if (r.game.status === "lobby" && r.game.owner === p.id) {
      const next = r.game.players.find((p) => p.connected);
      if (next) r.game.owner = next.id;
    }
    r.game.version++;
    store.save(r);
    broadcast(s.code);
  });
});
if (process.argv.includes("--production")) {
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
    mode: cloudMode ? "online" : "development",
  });
  app.use(vite.middlewares);
}
http.listen(port, "0.0.0.0", () => {
  console.log(
    `\n DEALZ · Around the table\n Local: http://localhost:${port}\n Wi-Fi: ${addresses.join("\n       ") || "No Wi-Fi address found"}\n Keep this laptop awake. Ctrl+C stops hosting.\n`,
  );
  QRCode.toString(addresses[0] || `http://localhost:${port}`, {
    type: "terminal",
    small: true,
  }).then(console.log);
});
