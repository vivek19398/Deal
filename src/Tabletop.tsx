import type { ReactNode, CSSProperties } from "react";
import {
  groups,
  type Card,
  type Color,
  type PublicPlayer,
  type View,
} from "../shared/model";
import { money } from "../shared/theme";
import { complete } from "../shared/engine";
import type { DropTarget } from "../shared/drop";
export const dropAttributes = (target: DropTarget) => ({
  "data-drop": JSON.stringify(target),
});
export function Tabletop({
  game,
  renderCard,
  onPay,
  selected,
  children,
}: {
  game: View;
  renderCard: (card: Card, own: boolean) => ReactNode;
  onPay: (id: string) => void;
  selected: string[];
  children: ReactNode;
}) {
  const own = (p: PublicPlayer) => p.id === game.you;
  return (
    <div className="tabletop">
      <div className="table-center" {...dropAttributes({ zone: "action" })}>
        <div className="draw-pile">
          <span>dealz.</span>
          <small>{game.deckCount} CARDS</small>
        </div>
        <div>
          <span className="eyebrow">BIHAR EDITION · ₹ CRORE</span>
          <strong>Apna shehar. Apna deal.</strong>
          <span>Drop an action here, or on the player you want to target.</span>
        </div>
        <div className="discard-pile">
          {game.discard.length ? (
            renderCard(game.discard[game.discard.length - 1], false)
          ) : (
            <span>↗</span>
          )}
          <small>{game.discard.length} PLAYED</small>
        </div>
      </div>
      {[...game.players]
        .sort((a, b) => Number(own(b)) - Number(own(a)))
        .map((p) => (
          <section
            key={p.id}
            className={`player-table ${own(p) ? "your-table" : ""} ${game.players[game.turn]?.id === p.id ? "active-table" : ""}`}
            {...dropAttributes({ zone: "opponent", owner: p.id })}
          >
            <div className="player-header">
              <div className="avatar">{p.name[0].toUpperCase()}</div>
              <div>
                <h3>
                  {p.name} {own(p) && <small>YOU</small>}
                  {game.status === "playing" &&
                    game.players[game.turn]?.id === p.id && (
                      <span className="turn-chip">
                        {own(p) ? "Your turn" : "Playing"}
                      </span>
                    )}
                </h3>
                <span>
                  {p.handCount} in hand ·{" "}
                  {new Set(p.sets.filter(complete).map((s) => s.color)).size}/3
                  sets {!p.connected && "· Offline"}
                </span>
              </div>
              <b className="bank-total">
                {money(p.bank.reduce((n, c) => n + c.value, 0))}
                <small>PUBLIC BANK</small>
              </b>
            </div>
            <div className="seat-table">
              <div className="private-front">
                <div className="zone-caption">
                  {own(p)
                    ? "YOUR HAND · ONLY YOU CAN SEE THIS"
                    : "PRIVATE HAND · FACES HIDDEN"}
                </div>
                {own(p) ? (
                  children
                ) : (
                  <div
                    className="hidden-hand"
                    aria-label={`${p.handCount} hidden cards`}
                  >
                    {Array.from(
                      { length: Math.min(p.handCount, 10) },
                      (_, i) => (
                        <div
                          className="card-back"
                          key={i}
                          style={{
                            transform: `rotate(${(i - (Math.min(p.handCount, 10) - 1) / 2) * 4}deg)`,
                          }}
                        >
                          <span>dealz.</span>
                        </div>
                      ),
                    )}
                    {!p.handCount && <p className="muted">No cards in hand</p>}
                  </div>
                )}
              </div>
              <div className="public-right">
                <div className="zone-caption">
                  PUBLIC TABLE · EVERYONE CAN SEE THIS
                </div>
                <div className="property-table">
                  {p.sets.map((s) => (
                    <div
                      className="property-group drop-group"
                      key={s.id}
                      {...dropAttributes({
                        zone: "group",
                        owner: p.id,
                        setId: s.id,
                        color: s.color,
                      })}
                      style={
                        {
                          "--group-color": groups[s.color].hex,
                        } as CSSProperties
                      }
                    >
                      <div
                        className="group-title"
                        style={{ borderColor: groups[s.color].hex }}
                      >
                        <strong>{groups[s.color].name}</strong>
                        <span>
                          {s.cards.length}/{groups[s.color].size}
                        </span>
                      </div>
                      <div className="mini-cards">
                        {[...s.cards, ...s.buildings].map((c) => (
                          <div
                            key={c.id}
                            {...dropAttributes({
                              zone: "group",
                              owner: p.id,
                              setId: s.id,
                              color: s.color,
                              cardId: c.id,
                            })}
                          >
                            {renderCard(c, own(p))}
                          </div>
                        ))}
                      </div>
                      <span className="rent-label">
                        Rent{" "}
                        {money(
                          groups[s.color].rent[
                            Math.min(s.cards.length, groups[s.color].size) - 1
                          ] +
                            s.buildings.reduce(
                              (n, c) => n + (c.action === "house" ? 3 : 4),
                              0,
                            ),
                        )}
                      </span>
                    </div>
                  ))}
                  {own(p) ? (
                    <div
                      className="new-property-zone"
                      {...dropAttributes({ zone: "new", owner: p.id })}
                    >
                      <span>＋</span>
                      <strong>New property set</strong>
                      <small>Drop a property here</small>
                    </div>
                  ) : (
                    !p.sets.length && (
                      <div className="empty-properties">
                        ⌂<span>No properties yet</span>
                      </div>
                    )
                  )}
                </div>
                <div
                  className="bank-row bank-drop"
                  {...dropAttributes({ zone: "bank", owner: p.id })}
                >
                  <span>BANK</span>
                  {p.bank.map((c) => (
                    <button
                      key={c.id}
                      className={`bank-chip ${selected.includes(c.id) ? "selected" : ""}`}
                      disabled={
                        !(
                          own(p) &&
                          game.pending?.responder === game.you &&
                          game.pending.stage === "payment"
                        )
                      }
                      onClick={() => onPay(c.id)}
                      title={c.name}
                    >
                      {money(c.value)}
                    </button>
                  ))}
                  {!p.bank.length && (
                    <span className="muted">
                      {own(p)
                        ? "Drop money or an action card to bank it"
                        : "Nothing banked yet"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>
        ))}
    </div>
  );
}
export function ShuffleDeal({ players }: { players: number }) {
  return (
    <div className="shuffle-overlay" role="status" aria-live="polite">
      <div className="shuffle-stack">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            className="shuffle-card"
            key={i}
            style={{ "--i": i } as CSSProperties}
          >
            <span>dealz.</span>
          </div>
        ))}
      </div>
      <div className="eyebrow">BIHAR EDITION</div>
      <h2>Shuffling the deck…</h2>
      <p>Dealing a little luck to {players} friends.</p>
    </div>
  );
}
