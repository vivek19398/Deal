import {
  groups,
  type Card,
  type Color,
  type Command,
  type View,
} from "./model.js";
export interface DropTarget {
  zone: "bank" | "group" | "new" | "action" | "opponent";
  owner?: string;
  setId?: string;
  color?: Color;
  cardId?: string;
}
export interface PlayPreset {
  setId?: string;
  target?: string;
  targetSet?: string;
  targetCard?: string;
  color?: Color;
}
export type DropIntent =
  { command: Command } | { prompt: PlayPreset; card: Card; moving: boolean };
/** Only routes gestures. The authoritative engine still validates every resulting command. */
export function dropIntent(
  game: View,
  cardId: string,
  moving: boolean,
  target: DropTarget,
): DropIntent {
  const me = game.players.find((p) => p.id === game.you)!;
  if (game.status !== "playing")
    throw Error("Start the game before playing cards.");
  if (game.paused)
    throw Error("Game paused. Ask the table host to press Resume game.");
  if (game.players[game.turn].id !== me.id)
    throw Error("Wait for your turn before playing this card.");
  if (game.pending)
    throw Error("Finish the pending action before playing another card.");
  if (!moving && game.plays >= 3)
    throw Error("All three card plays are used. End your turn.");
  const c = (
    moving
      ? me.sets.flatMap((s) => [...s.cards, ...s.buildings])
      : me.hand || []
  ).find((c) => c.id === cardId);
  if (!c)
    throw Error("That card is not available in your hand or on your table.");
  const property = c.kind === "property" || c.kind === "wild";
  const prompt = (preset: PlayPreset = {}): DropIntent => ({
    prompt: preset,
    card: c,
    moving,
  });
  if (target.zone === "bank") {
    if (target.owner !== me.id)
      throw Error("You can only bank cards in your own bank.");
    if (moving || property)
      throw Error(
        "Properties and cards already on the table cannot be banked.",
      );
    return { command: { type: "play", cardId: c.id, mode: "bank" } };
  }
  if (target.zone === "group") {
    const owner = game.players.find((p) => p.id === target.owner),
      s = owner?.sets.find((s) => s.id === target.setId);
    if (!s) throw Error("That property set is no longer available.");
    if (property) {
      if (owner!.id !== me.id)
        throw Error(
          "You cannot add properties to another player’s table. Use a legal action card to trade or steal.",
        );
      if (!c.colors?.includes(s.color))
        throw Error(
          `${c.name} cannot join a ${groups[s.color].name} set. Property colours must match.`,
        );
      if (moving && s.cards.some((x) => x.id === c.id))
        throw Error("That card is already in this set.");
      return {
        command: {
          type: moving ? "move" : "play",
          cardId: c.id,
          color: s.color,
          setId: s.id,
        },
      };
    }
    if (owner!.id === me.id) {
      if (c.action === "house" || c.action === "hotel")
        return {
          command: moving
            ? { type: "moveBuilding", cardId: c.id, setId: s.id }
            : { type: "play", cardId: c.id, setId: s.id },
        };
      if (c.kind === "rent") return prompt({ setId: s.id });
      throw Error(
        "Only matching properties, buildings or rent can be dropped on your property set.",
      );
    }
    if (moving) throw Error("You cannot move table cards to an opponent.");
    if (
      ["slyDeal", "forcedDeal", "dealBreaker", "debt"].includes(
        c.action || "",
      ) ||
      c.kind === "rent"
    )
      return prompt({
        target: owner!.id,
        targetSet: s.id,
        targetCard: target.cardId || s.cards[0]?.id,
      });
    throw Error("This card cannot target an opponent’s property set.");
  }
  if (target.zone === "new") {
    if (target.owner !== me.id || !property)
      throw Error("Only property cards can start your own property set.");
    if (c.colors!.length === 1)
      return {
        command: {
          type: moving ? "move" : "play",
          cardId: c.id,
          color: c.colors![0],
          setId: "new",
        },
      };
    return prompt({ setId: "new" });
  }
  if (moving) throw Error("Drop table cards onto a matching property set.");
  if (target.zone === "opponent" && target.owner !== me.id) {
    if (
      property ||
      c.kind === "money" ||
      ["no", "double", "house", "hotel", "passGo"].includes(c.action || "")
    )
      throw Error("This card cannot be played against another player.");
    return prompt({ target: target.owner });
  }
  if (property) return prompt();
  if (c.kind === "money") throw Error("Drop money into your bank.");
  if (c.action === "no" || c.action === "double")
    throw Error(
      "Use Just Say No in a response, or Double the Rent with a rent card.",
    );
  if (c.action === "passGo" || c.action === "birthday")
    return { command: { type: "play", cardId: c.id } };
  return prompt();
}
