import type { Envelope } from "./model.js";
const commands = new Set([
  "ready",
  "seat",
  "start",
  "endGame",
  "resume",
  "rematch",
  "leave",
  "play",
  "kick",
  "moveBuilding",
  "move",
  "end",
  "discard",
  "respond",
  "pay",
]);
export function validateEnvelope(value: unknown): Envelope {
  if (!value || typeof value !== "object") throw Error("Invalid command");
  const e = value as Envelope;
  if (
    typeof e.id !== "string" ||
    !e.id.trim() ||
    e.id.length > 100 ||
    !Number.isSafeInteger(e.version) ||
    e.version < 0 ||
    !e.command ||
    typeof e.command !== "object" ||
    !commands.has(e.command.type)
  )
    throw Error("Invalid command");
  const c = e.command as unknown as Record<string, unknown>;
  for (const field of [
    "cardId",
    "color",
    "setId",
    "target",
    "targetSet",
    "targetCard",
    "giveCard",
    "playerId",
  ])
    if (
      c[field] !== undefined &&
      (typeof c[field] !== "string" || (c[field] as string).length > 100)
    )
      throw Error("Invalid command field");
  for (const field of ["cardIds", "doubleIds"])
    if (
      c[field] !== undefined &&
      (!Array.isArray(c[field]) ||
        (c[field] as unknown[]).length > 106 ||
        !(c[field] as unknown[]).every(
          (id) => typeof id === "string" && id.length <= 100,
        ))
    )
      throw Error("Invalid card selection");
  if (["pay", "discard"].includes(e.command.type) && !Array.isArray(c.cardIds))
    throw Error("Choose cards first");
  if (e.command.type === "ready" && typeof c.ready !== "boolean")
    throw Error("Invalid ready status");
  if (e.command.type === "respond" && typeof c.no !== "boolean")
    throw Error("Invalid response");
  return e;
}
