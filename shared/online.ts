import type { Envelope, Game, Session, View } from "./model.js";
export interface OnlineMember {
  id: string;
  room_id: string;
  user_id: string;
  nickname: string;
  seat: number;
  ready: boolean;
  last_seen_at: string;
}
export interface OnlineSnapshot {
  room: { id: string; code: string; version: number; owner_user_id: string };
  state: Game;
  members: OnlineMember[];
}
export interface OnlineResponse {
  session?: Session;
  view?: View;
  left?: boolean;
  error?: string;
  code?: string;
}
export type OnlineRequest =
  | {
      action: "enter";
      create?: boolean;
      code?: string;
      name?: string;
      playerId?: string;
    }
  | { action: "state" | "heartbeat"; code: string }
  | { action: "command"; code: string; envelope: Envelope };
