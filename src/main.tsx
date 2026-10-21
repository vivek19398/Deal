import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { socket, localSocket, isCloud, SESSION_KEY } from "./transport";
import QRCode from "qrcode";
import {
  groups,
  type Card,
  type Color,
  type Command,
  type Reply,
  type Session,
  type View,
} from "../shared/model";
import "./style.css";
import { money, cardName } from "../shared/theme";
import { dropIntent, type DropTarget, type PlayPreset } from "../shared/drop";
import { ChatPanel } from "./ChatPanel";
import { useTableSounds } from "./useTableSounds";
import type { ChatMessage } from "../shared/chat";
import { Tabletop, ShuffleDeal } from "./Tabletop";
function InviteQR({ code }: { code: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (isCloud)
      void QRCode.toDataURL(`${location.origin}/?room=${code}`).then(setUrl);
  }, [code]);
  return (
    <img
      src={isCloud ? url : `/api/qr?room=${code}`}
      alt="Join table QR code"
    />
  );
}
const descriptions: Record<string, string> = {
  passGo: "Draw 2 extra cards.",
  slyDeal: "Take a property from an incomplete set.",
  forcedDeal:
    "Swap one of your properties for an opponent’s. Both must be in incomplete sets.",
  dealBreaker: "Take an entire complete set, including its buildings.",
  debt: "One opponent pays you ₹5 cr.",
  birthday: "Every opponent pays you ₹2 cr.",
  no: "Cancel an action against you, or counter another Just Say No.",
  double: "Play alongside rent to double the amount. Uses one play.",
  house: "Add ₹3 cr rent to a complete coloured set.",
  hotel: "Add ₹4 cr rent to a complete set with a house.",
};
function CardFace({
  card,
  small = false,
  selected = false,
  onClick,
  onPointerGrab,
}: {
  card: Card;
  small?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onPointerGrab?: (event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={`card ${card.kind} ${small ? "small" : ""} ${selected ? "selected" : ""}`}
      onClick={onClick}
      onPointerDown={onPointerGrab}
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      data-draggable={!!onPointerGrab}
      disabled={!onClick}
      style={
        {
          "--stripe": card.colors?.length
            ? `linear-gradient(110deg,${card.colors.map((c) => groups[c].hex).join(",")}${card.colors.length === 1 ? "," + groups[card.colors[0]].hex : ""})`
            : "#d4b879",
        } as React.CSSProperties
      }
    >
      <span className="card-top">
        {card.kind === "wild" ? "WILD PROPERTY" : card.kind.toUpperCase()}
        <b>{card.value ? money(card.value) : "WILD"}</b>
      </span>
      <span className="card-symbol">
        {card.kind === "money"
          ? "₹"
          : card.kind === "rent"
            ? "↗"
            : card.kind === "property"
              ? "⌂"
              : card.kind === "wild"
                ? "✦"
                : card.action === "no"
                  ? "✕"
                  : card.action === "house"
                    ? "⌂"
                    : card.action === "hotel"
                      ? "▤"
                      : "↗"}
      </span>
      <strong>{cardName(card)}</strong>
      {!small && (
        <span className="card-description">
          {card.kind === "action"
            ? descriptions[card.action!]
            : card.kind === "money"
              ? "A little buying power. Bank it for later."
              : card.kind === "rent"
                ? "Collect rent on a matching property group."
                : card.kind === "wild"
                  ? "Choose a colour. Move it on your turn."
                  : "Build your collection. Three sets wins."}
        </span>
      )}
      <span className="card-bottom">
        DEALZ <span>● ● ●</span>
      </span>
    </button>
  );
}
function App() {
  const [game, setGame] = useState<View>();
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const sounds = useTableSounds();
  const lastLog = useRef<string | undefined>(undefined);
  const [session, setSession] = useState<Session>();
  const [name, setName] = useState("");
  const [code, setCode] = useState(
    new URLSearchParams(location.search).get("room") || "",
  );
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Card>();
  const [moving, setMoving] = useState(false);
  const [rules, setRules] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [dealing, setDealing] = useState(false);
  const lastStatus = useRef<string | undefined>(undefined);
  const [preset, setPreset] = useState<PlayPreset>({});
  const [drag, setDrag] = useState<{ card: Card; x: number; y: number } | null>(
    null,
  );
  const dragRef = useRef<{
    card: Card;
    moving: boolean;
    startX: number;
    startY: number;
    active: boolean;
    pointerId: number;
    element: HTMLButtonElement;
  } | null>(null);
  const suppressClick = useRef(0);
  const latest = useRef<{ game?: View; busy: boolean; connected: boolean }>({
    busy: false,
    connected: false,
  });
  latest.current = { game, busy, connected };
  const sendRef = useRef<(command: Command) => void>(() => {});
  const highlighted = useRef<Element | null>(null);

  useEffect(() => {
    if (isCloud) setHost([location.origin]);
    else
      fetch("/api/host")
        .then((r) => r.json())
        .then((r) => setHost(r.addresses))
        .catch(() => {});
    const restore = () => {
      setConnected(true);
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) {
        try {
          const s = JSON.parse(saved);
          socket.emit("enter", s, (r: Reply) => {
            if (r.error) {
              setError(r.error);
              if (!isCloud) localStorage.removeItem(SESSION_KEY);
              setGame(undefined);
              setSession(undefined);
            } else setSession(r.session);
          });
        } catch {
          localStorage.removeItem(SESSION_KEY);
        }
      }
    };
    socket.on("connect", restore);
    socket.on("error", (message: string) => setError(message));
    socket.on("disconnect", () => setConnected(false));
    socket.on("state", (g: View) => {
      if (lastStatus.current === "lobby" && g.status === "playing")
        setDealing(true);
      lastStatus.current = g.status;
      if (lastLog.current && lastLog.current !== g.log[0]) sounds.play();
      lastLog.current = g.log[0];
      setGame(g);
      setBusy(false);
    });
    socket.on("chat:history", (messages: ChatMessage[]) => setChat(messages));
    socket.on("chat:message", (message: ChatMessage) => {
      setChat((messages) =>
        messages.some((m) => m.id === message.id)
          ? messages
          : [...messages, message].slice(-100),
      );
    });
    socket.on("left", () => {
      setChat([]);
      localStorage.removeItem(SESSION_KEY);
      setSession(undefined);
      setGame(undefined);
      socket.disconnect();
      socket.connect();
    });
    socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setChosen(undefined);
        setRules(false);
        setShowInvite(false);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  useEffect(() => {
    if (!dealing) return;
    const timer = setTimeout(() => setDealing(false), 2600);
    return () => clearTimeout(timer);
  }, [dealing]);
  useEffect(() => {
    const targetAt = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest("[data-drop]") || null;
    const cleanup = () => {
      highlighted.current?.classList.remove("drop-hover");
      highlighted.current = null;
      const current = dragRef.current;
      dragRef.current = null;
      if (current?.element.hasPointerCapture(current.pointerId))
        current.element.releasePointerCapture(current.pointerId);
      setDrag(null);
    };
    const move = (event: PointerEvent) => {
      const d = dragRef.current;
      if (!d || event.pointerId !== d.pointerId) return;
      if (
        !d.active &&
        Math.hypot(event.clientX - d.startX, event.clientY - d.startY) < 8
      )
        return;
      d.active = true;
      event.preventDefault();
      setDrag({ card: d.card, x: event.clientX, y: event.clientY });
      const target = targetAt(event.clientX, event.clientY);
      if (highlighted.current !== target) {
        highlighted.current?.classList.remove("drop-hover");
        highlighted.current = target;
        target?.classList.add("drop-hover");
      }
      if (event.clientY < 85) window.scrollBy(0, -12);
      else if (event.clientY > window.innerHeight - 65) window.scrollBy(0, 12);
    };
    const end = (event: PointerEvent) => {
      const d = dragRef.current;
      if (!d || event.pointerId !== d.pointerId) return;
      if (d.active) {
        suppressClick.current = Date.now() + 450;
        const element = targetAt(event.clientX, event.clientY);
        const current = latest.current;
        try {
          if (!element)
            throw Error(
              "Drop onto your bank, a property set, or an action target.",
            );
          if (!current.game || current.busy || !current.connected)
            throw Error(
              "Wait for the table to reconnect or finish its current move.",
            );
          const intent = dropIntent(
            current.game,
            d.card.id,
            d.moving,
            JSON.parse(element.getAttribute("data-drop")!) as DropTarget,
          );
          if ("command" in intent) sendRef.current(intent.command);
          else {
            setPreset(intent.prompt);
            setChosen(intent.card);
            setMoving(intent.moving);
          }
        } catch (error) {
          setError((error as Error).message);
        }
      }
      cleanup();
    };
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === dragRef.current?.pointerId) cleanup();
    };
    window.addEventListener("blur", cleanup);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cleanup);
    };
  }, []);
  const enter = (create: boolean) => {
    setError("");
    setBusy(true);
    socket
      .timeout(isCloud ? 25000 : 7000)
      .emit(
        "enter",
        { create, name, code: code.toUpperCase() },
        (err: Error | null, r: Reply) => {
          setBusy(false);
          if (err) return setError("Cannot reach the host. Check your Wi-Fi.");
          if (r.error) return setError(r.error);
          setSession(r.session);
          localStorage.setItem(SESSION_KEY, JSON.stringify(r.session));
        },
      );
  };
  const send = (command: Command) => {
    if (!game || busy || !connected) return;
    setError("");
    setBusy(true);
    socket.timeout(isCloud ? 25000 : 7000).emit(
      "command",
      {
        id:
          globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        version: game.version,
        command,
      },
      (err: Error | null, r: Reply) => {
        setBusy(false);
        if (err)
          return setError(
            "The host did not reply. Your table will refresh when connected.",
          );
        if (r.error) setError(r.error);
        else {
          setChosen(undefined);
          setSelected([]);
        }
      },
    );
  };
  sendRef.current = send;
  const startDrag =
    (card: Card, moving: boolean) =>
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      // Keep receiving touch/mouse movement even across buttons and outside the card.
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        card,
        moving,
        pointerId: event.pointerId,
        element: event.currentTarget,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
      };
    };
  const openCard = (card: Card, moving: boolean) => {
    if (Date.now() < suppressClick.current) return;
    setPreset({});
    setChosen(card);
    setMoving(moving);
  };
  const me = game?.players.find((p) => p.id === game.you);
  const isOwner = game?.owner === game?.you;
  const myTurn = !!game && game.players[game.turn]?.id === game.you;
  const canPlay =
    game?.status === "playing" &&
    myTurn &&
    !game.pending &&
    !game.paused &&
    !dealing;
  const pending = game?.pending;
  const responder = pending?.responder === game?.you;
  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  return (
    <div className="app">
      <header>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            if (game) e.preventDefault();
          }}
        >
          dealz<span>●</span>
        </a>
        <span className="header-note">BIHAR KE LOG. BADE DEALS.</span>
        <div className="header-actions">
          <span className={`connection ${connected ? "" : "offline"}`}>
            <i />
            {connected
              ? isCloud
                ? "ONLINE TABLE"
                : "LOCAL CONNECTION"
              : "RECONNECTING"}
          </span>
          <button
            className="text-button sound-toggle"
            aria-pressed={sounds.enabled}
            onClick={() => void sounds.toggle()}
          >
            {sounds.enabled ? "♫ Sound on" : "♪ Sound off"}
          </button>
          <button className="text-button" onClick={() => setRules(true)}>
            How to play ↗
          </button>
        </div>
      </header>
      {error && (
        <div role="alert" className="toast">
          {error}
          <button onClick={() => setError("")}>✕</button>
        </div>
      )}
      {!game ? (
        <main className="welcome">
          <div className="hero-copy">
            <div className="eyebrow">THE TABLE IS ALWAYS OPEN</div>
            <h1>
              Big deals.
              <br />
              Little cards.
              <br />
              <em>Your people.</em>
            </h1>
            <p>
              A friendly game of property, quick thinking, and
              <br className="desktop" /> occasionally questionable friendships.
            </p>
            <div className="hero-details">
              <span>◉ 2–5 players</span>
              <span>◷ About 15 minutes</span>
              <span>⌁ {isCloud ? "Play online" : "Same Wi-Fi"}</span>
            </div>
            <div className="card-scene" aria-hidden="true">
              <div className="scene-card back-card">
                <span>dealz.</span>
              </div>
              <div className="scene-card property-art">
                <div className="art-band">THE GOOD LIFE</div>
                <span className="art-icon">⌂</span>
                <strong>
                  A place
                  <br />
                  of your own.
                </strong>
                <span>PROPERTY COLLECTION · 03</span>
              </div>
              <div className="scene-card money-art">
                <span>BANK OF BIHAR</span>
                <strong>
                  5<span>cr</span>
                </strong>
                <span>MAKE YOUR NEXT MOVE.</span>
              </div>
              <span className="spark spark-one">✦</span>
              <span className="spark spark-two">✳</span>
            </div>
          </div>
          <section className="entry-panel">
            <div className="eyebrow">PULL UP A CHAIR</div>
            <h2>
              Make yourself
              <br />
              at home.
            </h2>
            <p>One table. Everyone’s invited.</p>
            <label>
              Your nickname
              <input
                autoComplete="nickname"
                maxLength={24}
                placeholder="What should we call you?"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) enter(false);
                }}
              />
            </label>
            <button
              className="primary full"
              disabled={busy || !connected || !name.trim()}
              onClick={() => enter(true)}
            >
              Create a table <span>↗</span>
            </button>
            <div className="divider">
              <span>OR JOIN YOUR FRIENDS</span>
            </div>
            <label>
              Table code
              <input
                className="code-input"
                maxLength={6}
                placeholder="ABC123"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </label>
            <button
              className="secondary full"
              disabled={busy || !connected || !name.trim() || code.length !== 6}
              onClick={() => enter(false)}
            >
              Join the table <span>→</span>
            </button>
            <div className="local-note">
              ⌁{" "}
              <span>
                {isCloud
                  ? "Your people. One online table."
                  : "Made for the same Wi-Fi."}
                <br />
                No accounts. No downloads. Just play.
              </span>
            </div>
          </section>
          <footer>
            BIHAR EDITION · ALL VALUES IN ₹ CRORE.
            <span>A little luck. A lot of possibilities.</span>
          </footer>
        </main>
      ) : (
        <main className="game-shell">
          <div className="table-heading">
            <div>
              <div className="eyebrow">YOUR PRIVATE TABLE</div>
              <h1>
                {game.status === "lobby"
                  ? "Good company starts here."
                  : game.status === "finished"
                    ? "That’s a deal."
                    : "Make your next move."}
              </h1>
            </div>
            <button className="room-pill" onClick={() => setShowInvite(true)}>
              TABLE <b>{game.code}</b> <span>⌁ Invite</span>
            </button>
          </div>
          {game.status === "lobby" ? (
            <div className="lobby-layout">
              <section className="lobby-card">
                <div className="section-heading">
                  <h2>The guest list</h2>
                  <span>{game.players.length} / 5 seated</span>
                </div>
                <p className="muted">
                  Choose your seat. Get comfortable. Make a deal.
                </p>
                {game.players.map((p, i) => (
                  <div className="seat-row" key={p.id}>
                    <div className={`avatar avatar-${i}`}>
                      {p.name[0].toUpperCase()}
                    </div>
                    <div>
                      <strong>
                        {p.name} {p.id === game.you && <small>YOU</small>}
                      </strong>
                      <span>
                        {p.id === game.owner ? "Table host · " : ""}
                        {p.connected ? "At the table" : "Disconnected"}
                      </span>
                    </div>
                    <span className={`ready-tag ${p.ready ? "yes" : ""}`}>
                      {p.ready ? "✓ Ready" : "Getting settled"}
                    </span>
                    {isOwner && !p.connected && (
                      <button
                        className="text-button"
                        onClick={() => send({ type: "kick", playerId: p.id })}
                      >
                        Remove
                      </button>
                    )}
                    {p.id !== game.you && (
                      <button
                        className="text-button"
                        onClick={() => send({ type: "seat", seat: i })}
                      >
                        Sit here
                      </button>
                    )}
                  </div>
                ))}
                {Array.from({ length: 5 - game.players.length }, (_, i) => (
                  <div className="empty-seat" key={i}>
                    ＋ A seat for a friend
                  </div>
                ))}
                <div className="lobby-controls">
                  <button
                    className={me?.ready ? "secondary" : "primary"}
                    disabled={busy}
                    onClick={() => send({ type: "ready", ready: !me?.ready })}
                  >
                    {me?.ready ? "✓ Ready · undo" : "I’m ready"}
                  </button>
                  {isOwner && (
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        game.players.length < 2 ||
                        game.players.some((p) => !p.ready || !p.connected)
                      }
                      onClick={() => send({ type: "start" })}
                    >
                      Deal the cards →
                    </button>
                  )}
                  <button
                    className="text-button"
                    onClick={() => send({ type: "leave" })}
                  >
                    Leave table
                  </button>
                </div>
              </section>
              <aside className="invite-card">
                <div className="eyebrow">THE MORE THE MERRIER</div>
                <h2>
                  Bring your
                  <br />
                  people together.
                </h2>
                <InviteQR code={game.code} />
                <strong className="invite-code">{game.code}</strong>
                <p>
                  {isCloud
                    ? "Scan this code to join,"
                    : "On the same Wi-Fi? Scan this code,"}
                  <br />
                  enter your nickname, and take a seat.
                </p>
                <span className="address">{host[0] || location.origin}</span>
              </aside>
            </div>
          ) : (
            <>
              <section className="status-bar">
                <div>
                  <span className="eyebrow">
                    {game.status === "finished"
                      ? "GAME COMPLETE"
                      : game.paused
                        ? "TABLE PAUSED"
                        : myTurn
                          ? "YOUR TURN"
                          : `${game.players[game.turn].name.toUpperCase()}’S TURN`}
                  </span>
                  <strong>
                    {game.status === "finished"
                      ? game.winner
                        ? `${game.players.find((p) => p.id === game.winner)?.name} wins!`
                        : "Game ended by host"
                      : game.paused
                        ? "Waiting for everyone to return"
                        : pending
                          ? "A deal is in progress"
                          : `${3 - game.plays} card plays remaining`}
                  </strong>
                </div>
                <div className="deck-badge">
                  ▧ {game.deckCount} in deck{" "}
                  <span>· {game.discard.length} discarded</span>
                </div>
                {canPlay && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      if (me!.handCount > 7) {
                        setError(
                          `Select ${me!.handCount - 7} cards in your hand, then discard.`,
                        );
                      } else send({ type: "end" });
                    }}
                  >
                    End turn →
                  </button>
                )}
                {game.paused && isOwner && (
                  <button
                    className="primary"
                    onClick={() => send({ type: "resume" })}
                  >
                    Resume game
                  </button>
                )}
                {game.status === "finished" && isOwner && (
                  <button
                    className="primary"
                    onClick={() => send({ type: "rematch" })}
                  >
                    Play again ↗
                  </button>
                )}
              </section>
              {game.status === "finished" && game.winner && (
                <section className="winner-banner">
                  <span aria-hidden="true">✦</span>
                  <div>
                    <div className="eyebrow">THE BEST DEAL OF THE NIGHT</div>
                    <h2>
                      {game.players.find((p) => p.id === game.winner)?.name}{" "}
                      takes the table.
                    </h2>
                    <p>
                      Three collections. One very good deal. Who’s up for
                      another round?
                    </p>
                  </div>
                  <span aria-hidden="true">✦</span>
                </section>
              )}
              {pending && (
                <section className="pending-panel">
                  <div>
                    <span className="eyebrow">
                      {pending.stage === "payment"
                        ? "SETTLE UP"
                        : "A MOMENT TO RESPOND"}
                    </span>
                    <h3>
                      {
                        game.players.find((p) => p.id === pending.effect.actor)
                          ?.name
                      }{" "}
                      →{" "}
                      {
                        game.players.find((p) => p.id === pending.effect.target)
                          ?.name
                      }
                    </h3>
                    <p>
                      {pending.effect.kind === "payment"
                        ? `${money(pending.effect.amount!)} requested`
                        : pending.effect.kind === "breaker"
                          ? "A complete property set is being taken"
                          : pending.effect.kind === "forced"
                            ? "A property swap is proposed"
                            : "A property is being taken"}
                      . {pending.cancelled ? "Action currently blocked." : ""}
                    </p>
                  </div>
                  {responder && !game.paused ? (
                    <div className="response-actions">
                      {pending.stage === "response" ? (
                        <>
                          <p>
                            {pending.cancelled
                              ? "Accept the block or play Just Say No to counter."
                              : "Accept the action or play Just Say No to block."}
                          </p>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => send({ type: "respond", no: false })}
                          >
                            {pending.cancelled
                              ? "Accept block"
                              : "Accept action"}
                          </button>
                          <button
                            className="primary"
                            disabled={
                              busy || !me?.hand?.some((c) => c.action === "no")
                            }
                            onClick={() => send({ type: "respond", no: true })}
                          >
                            Just Say No
                          </button>
                        </>
                      ) : (
                        <>
                          <p>
                            Select assets from your bank or properties below. No
                            change is given.
                          </p>
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() =>
                              send({ type: "pay", cardIds: selected })
                            }
                          >
                            Pay selected assets (
                            {money(
                              [
                                ...me!.bank,
                                ...me!.sets.flatMap((s) => [
                                  ...s.cards,
                                  ...s.buildings,
                                ]),
                              ]
                                .filter((c) => selected.includes(c.id))
                                .reduce((n, c) => n + c.value, 0),
                            )}
                            )
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="muted">
                      Waiting for{" "}
                      {
                        game.players.find((p) => p.id === pending.responder)
                          ?.name
                      }
                      …
                    </p>
                  )}
                </section>
              )}
              <div className="play-layout">
                <Tabletop
                  game={game}
                  selected={selected}
                  onPay={toggle}
                  renderCard={(c, own) => (
                    <CardFace
                      card={c}
                      small
                      selected={selected.includes(c.id)}
                      onClick={
                        own &&
                        ((responder && pending?.stage === "payment") || canPlay)
                          ? () => {
                              if (pending?.stage === "payment") toggle(c.id);
                              else openCard(c, true);
                            }
                          : undefined
                      }
                      onPointerGrab={
                        own && canPlay ? startDrag(c, true) : undefined
                      }
                    />
                  )}
                >
                  {" "}
                  <section className="hand-area">
                    <div className="section-heading">
                      <div>
                        <span className="eyebrow">A FEW POSSIBILITIES</span>
                        <h2>
                          Your hand <span>{me?.handCount}</span>
                        </h2>
                      </div>
                      <span className="muted">
                        {canPlay && game.plays < 3
                          ? "Drag a card to your table, bank or action area. Tap for options."
                          : game.paused
                            ? "Game paused. The host must resume before cards can be played."
                            : pending
                              ? "Finish the pending action before playing cards."
                              : !myTurn
                                ? "Drag cards to play when it’s your turn."
                                : "All three plays used. End your turn."}
                      </span>
                    </div>
                    {canPlay && me!.handCount > 7 && (
                      <div className="discard-bar">
                        <span>
                          Before ending, select {me!.handCount - 7} cards to
                          discard.
                        </span>
                        <button
                          className="secondary"
                          disabled={selected.length !== me!.handCount - 7}
                          onClick={() =>
                            send({ type: "discard", cardIds: selected })
                          }
                        >
                          Discard & end turn ({selected.length})
                        </button>
                      </div>
                    )}
                    <div className="hand">
                      {me?.hand?.map((c) => (
                        <div className="hand-slot" key={c.id}>
                          <CardFace
                            card={c}
                            selected={selected.includes(c.id)}
                            onClick={() => openCard(c, false)}
                            onPointerGrab={
                              game.status === "playing" && !dealing
                                ? startDrag(c, false)
                                : undefined
                            }
                          />
                          {canPlay && me!.handCount > 7 && (
                            <label className="discard-check">
                              <input
                                type="checkbox"
                                checked={selected.includes(c.id)}
                                onChange={() => toggle(c.id)}
                              />
                              Discard
                            </label>
                          )}
                        </div>
                      ))}
                      {!me?.handCount && (
                        <p className="muted">
                          A fresh hand is just a turn away.
                        </p>
                      )}
                    </div>
                  </section>
                </Tabletop>
                <aside className="activity">
                  <div className="eyebrow">AROUND THE TABLE</div>
                  <h3>The latest deals</h3>
                  {game.log.slice(0, 12).map((l, i) => (
                    <p key={i}>
                      <span className="log-dot" />
                      {l}
                    </p>
                  ))}
                  <button
                    className="text-button"
                    onClick={() => setRules(true)}
                  >
                    Need a refresher? ↗
                  </button>
                  {isOwner && game.status === "playing" && (
                    <button
                      className="text-button danger"
                      onClick={() => {
                        if (confirm("End this game for everyone?"))
                          send({ type: "endGame" });
                      }}
                    >
                      End game for everyone
                    </button>
                  )}
                </aside>
              </div>
            </>
          )}
        </main>
      )}
      {game && localSocket && (
        <ChatPanel
          key={game.code}
          messages={chat}
          you={game.you}
          room={game.code}
          connected={connected}
          socket={localSocket}
        />
      )}
      {dealing && game?.status === "playing" && (
        <ShuffleDeal players={game.players.length} />
      )}
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          <CardFace card={drag.card} />
        </div>
      )}
      {chosen && game && me && (
        <PlayDialog
          key={`${chosen.id}-${moving}`}
          card={chosen}
          preset={preset}
          moving={moving}
          game={game}
          enabled={!!canPlay && !busy && (moving || game.plays < 3)}
          onClose={() => setChosen(undefined)}
          onPlay={send}
        />
      )}
      {showInvite && game && (
        <div className="modal-overlay" onClick={() => setShowInvite(false)}>
          <section
            className="modal invite-card"
            role="dialog"
            aria-modal="true"
            aria-label="Invite friends"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="Close dialog"
              onClick={() => setShowInvite(false)}
            >
              ✕
            </button>
            <div className="eyebrow">PULL UP A CHAIR</div>
            <h2>Share your table.</h2>
            <InviteQR code={game.code} />
            <strong className="invite-code">{game.code}</strong>
            <p>
              {isCloud
                ? "Share this address to join:"
                : "Open this address on the same Wi-Fi:"}
            </p>
            {host.map((h) => (
              <p className="address" key={h}>
                {h}/?room={game.code}
              </p>
            ))}
          </section>
        </div>
      )}
      {rules && (
        <div className="modal-overlay" onClick={() => setRules(false)}>
          <section
            className="modal rules"
            role="dialog"
            aria-modal="true"
            aria-label="How to play"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="Close dialog"
              onClick={() => setRules(false)}
            >
              ✕
            </button>
            <div className="eyebrow">A QUICK REFRESHER</div>
            <h2>
              Three sets.
              <br />
              Endless possibilities.
            </h2>
            <p>
              Complete three property sets of different colours to win. Each
              player starts with five cards. Your turn draws two cards
              automatically, or five if your hand was empty.
            </p>
            <ol>
              <li>
                <strong>Make up to three plays.</strong> Bank money or action
                cards, add a property, or play an action. You can end early.
              </li>
              <li>
                <strong>Make your money work.</strong> Rent uses a matching
                group. Two-colour rent charges everyone; any-colour rent charges
                one opponent. Each Double the Rent costs another play.
              </li>
              <li>
                <strong>Settle your debts.</strong> Pay from your bank or table,
                never your hand. You choose the assets. No change is given; if
                short, pay everything with a monetary value.
              </li>
              <li>
                <strong>Have the last word.</strong> Just Say No can block an
                action against you. The other player may counter it. Responses
                don’t use your turn’s plays.
              </li>
              <li>
                <strong>Finish tidy.</strong> End with at most seven cards.
                Wildcards can move on your turn without using a play, unless
                buildings are attached.
              </li>
            </ol>
            <p>
              Complete coloured sets can hold one house, then one hotel.
              Railroads and utilities cannot. Buildings from a set broken by
              payment become banked money. Full rules and local clarifications
              are included in RULES.md.
            </p>
            <button className="primary full" onClick={() => setRules(false)}>
              Back to the table →
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
function PlayDialog({
  card,
  preset,
  moving,
  game,
  enabled,
  onClose,
  onPlay,
}: {
  card: Card;
  preset: PlayPreset;
  moving: boolean;
  game: View;
  enabled: boolean;
  onClose: () => void;
  onPlay: (c: Command) => void;
}) {
  const me = game.players.find((p) => p.id === game.you)!;
  const [color, setColor] = useState<Color>(
    preset.color || card.colors?.[0] || "brown",
  );
  const [setId, setSet] = useState(preset.setId || "");
  const [target, setTarget] = useState(
    preset.target || game.players.find((p) => p.id !== game.you)?.id || "",
  );
  const [targetSet, setTargetSet] = useState(preset.targetSet || "");
  const [targetCard, setTargetCard] = useState(preset.targetCard || "");
  const [giveCard, setGive] = useState("");
  const [doubles, setDoubles] = useState<string[]>([]);
  const opponent = game.players.find((p) => p.id === target);
  const buildingMove =
    moving && (card.action === "house" || card.action === "hotel");
  const property = card.kind === "property" || card.kind === "wild";
  const usesGroup =
    buildingMove ||
    card.kind === "rent" ||
    card.action === "house" ||
    card.action === "hotel";
  const needsTarget =
    card.action === "debt" ||
    ["slyDeal", "forcedDeal", "dealBreaker"].includes(card.action || "") ||
    (card.kind === "rent" && card.colors?.length === 10);
  const noPlay =
    card.kind === "money" || ["no", "double"].includes(card.action || "");
  return (
    <div className="modal-overlay" onClick={onClose}>
      <section
        className="modal play-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={card.name}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="close" aria-label="Close dialog" onClick={onClose}>
          ✕
        </button>
        <div className="dialog-card">
          <CardFace card={card} />
        </div>
        <div className="dialog-controls">
          <div className="eyebrow">
            {moving ? "REARRANGE YOUR PORTFOLIO" : "MAKE IT COUNT"}
          </div>
          <h2>{card.name}</h2>
          <p className="muted">
            {descriptions[card.action!] || "Every card opens a possibility."}
          </p>
          {property && (
            <>
              <label>
                Property colour
                <select
                  value={color}
                  onChange={(e) => {
                    setColor(e.target.value as Color);
                    setSet("");
                  }}
                >
                  {card.colors!.map((c) => (
                    <option key={c} value={c}>
                      {groups[c].name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Destination
                <select value={setId} onChange={(e) => setSet(e.target.value)}>
                  <option value="">First available group / new group</option>
                  <option value="new">Start a separate group</option>
                  {me.sets
                    .filter(
                      (s) =>
                        s.color === color &&
                        s.cards.length < groups[color].size,
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {groups[s.color].name} ({s.cards.length}/
                        {groups[s.color].size})
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
          {usesGroup && (
            <label>
              Your property group
              <select value={setId} onChange={(e) => setSet(e.target.value)}>
                <option value="">Choose a group</option>
                {me.sets
                  .filter(
                    (s) =>
                      card.kind !== "rent" || card.colors?.includes(s.color),
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {groups[s.color].name} · {s.cards.length} properties
                    </option>
                  ))}
              </select>
            </label>
          )}
          {needsTarget && (
            <label>
              Opponent
              <select
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setTargetCard("");
                  setTargetSet("");
                }}
              >
                {game.players
                  .filter((p) => p.id !== game.you)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {card.action === "dealBreaker" && (
            <label>
              Their complete set
              <select
                value={targetSet}
                onChange={(e) => setTargetSet(e.target.value)}
              >
                <option value="">Choose a set</option>
                {opponent?.sets
                  .filter((s) => s.cards.length === groups[s.color].size)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {groups[s.color].name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {["slyDeal", "forcedDeal"].includes(card.action || "") && (
            <label>
              Their property
              <select
                value={targetCard}
                onChange={(e) => setTargetCard(e.target.value)}
              >
                <option value="">Choose a property</option>
                {opponent?.sets
                  .filter((s) => s.cards.length < groups[s.color].size)
                  .flatMap((s) =>
                    s.cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {groups[s.color].name}: {c.name}
                      </option>
                    )),
                  )}
              </select>
            </label>
          )}
          {card.action === "forcedDeal" && (
            <label>
              Your property to exchange
              <select
                value={giveCard}
                onChange={(e) => setGive(e.target.value)}
              >
                <option value="">Choose your property</option>
                {me.sets
                  .filter((s) => s.cards.length < groups[s.color].size)
                  .flatMap((s) =>
                    s.cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {groups[s.color].name}: {c.name}
                      </option>
                    )),
                  )}
              </select>
            </label>
          )}
          {card.kind === "rent" &&
            me.hand
              ?.filter((c) => c.action === "double")
              .map((c) => (
                <label className="check-label" key={c.id}>
                  <input
                    type="checkbox"
                    checked={doubles.includes(c.id)}
                    onChange={() =>
                      setDoubles((a) =>
                        a.includes(c.id)
                          ? a.filter((id) => id !== c.id)
                          : [...a, c.id],
                      )
                    }
                  />
                  Double the Rent (+1 play)
                </label>
              ))}
          {!noPlay && (
            <button
              className="primary full"
              disabled={!enabled || (usesGroup && !setId)}
              onClick={() =>
                onPlay(
                  buildingMove
                    ? { type: "moveBuilding", cardId: card.id, setId }
                    : moving
                      ? {
                          type: "move",
                          cardId: card.id,
                          color,
                          setId: setId || undefined,
                        }
                      : {
                          type: "play",
                          cardId: card.id,
                          color,
                          setId: setId || undefined,
                          target,
                          targetSet,
                          targetCard,
                          giveCard,
                          doubleIds: doubles,
                        },
                )
              }
            >
              {moving ? "Move card →" : "Play this card →"}
            </button>
          )}
          {!property && !moving && (
            <button
              className="secondary full"
              disabled={!enabled}
              onClick={() =>
                onPlay({ type: "play", cardId: card.id, mode: "bank" })
              }
            >
              Bank for {money(card.value)}
            </button>
          )}
          {!enabled && (
            <p className="muted">
              {game.plays >= 3
                ? "All three plays used. You can end your turn."
                : "You can play cards on your turn."}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
