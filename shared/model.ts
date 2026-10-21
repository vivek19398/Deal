export const colors = [
  "brown",
  "lightBlue",
  "pink",
  "orange",
  "red",
  "yellow",
  "green",
  "darkBlue",
  "railroad",
  "utility",
] as const;
export type Color = (typeof colors)[number];
export const groups: Record<
  Color,
  { name: string; size: number; rent: number[]; hex: string; value: number }
> = {
  brown: { name: "Brown", size: 2, rent: [1, 2], hex: "#916247", value: 1 },
  lightBlue: {
    name: "Sky blue",
    size: 3,
    rent: [1, 2, 3],
    hex: "#73bcd4",
    value: 1,
  },
  pink: { name: "Pink", size: 3, rent: [1, 2, 4], hex: "#cf759b", value: 2 },
  orange: {
    name: "Orange",
    size: 3,
    rent: [1, 3, 5],
    hex: "#e99a45",
    value: 2,
  },
  red: { name: "Red", size: 3, rent: [2, 3, 6], hex: "#d85c57", value: 3 },
  yellow: {
    name: "Yellow",
    size: 3,
    rent: [2, 4, 6],
    hex: "#e3c754",
    value: 3,
  },
  green: { name: "Green", size: 3, rent: [2, 4, 7], hex: "#60a47a", value: 4 },
  darkBlue: { name: "Navy", size: 2, rent: [3, 8], hex: "#5378b6", value: 4 },
  railroad: {
    name: "Railroad",
    size: 4,
    rent: [1, 2, 3, 4],
    hex: "#60636d",
    value: 2,
  },
  utility: { name: "Utility", size: 2, rent: [1, 2], hex: "#a5b59a", value: 2 },
};
export type Action =
  | "passGo"
  | "slyDeal"
  | "forcedDeal"
  | "dealBreaker"
  | "debt"
  | "birthday"
  | "no"
  | "double"
  | "house"
  | "hotel";
export interface Card {
  id: string;
  kind: "money" | "property" | "wild" | "rent" | "action";
  name: string;
  value: number;
  colors?: Color[];
  action?: Action;
}
export interface SetGroup {
  id: string;
  color: Color;
  cards: Card[];
  buildings: Card[];
}
export interface Player {
  id: string;
  name: string;
  token: string;
  connected: boolean;
  ready: boolean;
  hand: Card[];
  bank: Card[];
  sets: SetGroup[];
}
export interface Effect {
  actor: string;
  target: string;
  kind: "payment" | "sly" | "forced" | "breaker";
  amount?: number;
  setId?: string;
  cardId?: string;
  giveId?: string;
}
export interface Pending {
  effects: Effect[];
  effect: Effect;
  stage: "response" | "payment";
  responder: string;
  cancelled: boolean;
}
export interface Game {
  code: string;
  owner: string;
  players: Player[];
  status: "lobby" | "playing" | "finished";
  version: number;
  turn: number;
  plays: number;
  deck: Card[];
  discard: Card[];
  pending?: Pending;
  paused: boolean;
  winner?: string;
  log: string[];
}
export type Command =
  | { type: "ready"; ready: boolean }
  | { type: "seat"; seat: number }
  | { type: "start" }
  | { type: "endGame" }
  | { type: "resume" }
  | { type: "rematch" }
  | { type: "leave" }
  | {
      type: "play";
      cardId: string;
      mode?: "bank";
      color?: Color;
      setId?: string;
      target?: string;
      targetSet?: string;
      targetCard?: string;
      giveCard?: string;
      doubleIds?: string[];
    }
  | { type: "kick"; playerId: string }
  | { type: "moveBuilding"; cardId: string; setId: string }
  | { type: "move"; cardId: string; color: Color; setId?: string }
  | { type: "end" }
  | { type: "discard"; cardIds: string[] }
  | { type: "respond"; no: boolean }
  | { type: "pay"; cardIds: string[] };
export interface Envelope {
  id: string;
  version: number;
  command: Command;
}
export type PublicPlayer = Omit<Player, "token" | "hand"> & {
  handCount: number;
  hand?: Card[];
};
export type View = Omit<Game, "players" | "deck"> & {
  players: PublicPlayer[];
  deckCount: number;
  you: string;
};
export interface Session {
  roomId?: string;
  code: string;
  playerId: string;
  token: string;
}
export interface Reply {
  error?: string;
  session?: Session;
}
