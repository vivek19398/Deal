import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { io } from "socket.io-client";
import type { Session, View } from "../shared/model";
import type { OnlineResponse } from "../shared/online";
export const isCloud = import.meta.env.VITE_CLOUD_MODE === "true";
export const SESSION_KEY = isCloud ? "dealz-online-session" : "dealz-session";
export const localSocket = isCloud ? undefined : io({ autoConnect: false });
class CloudTransport {
  private listeners = new Map<string, Set<(...args: any[]) => void>>();
  private client?: SupabaseClient;
  private session?: Session;
  private timer?: ReturnType<typeof setInterval>;
  private channel?: ReturnType<SupabaseClient["channel"]>;
  private version = -1;
  private refreshing = false;
  private active = false;
  on(event: string, fn: (...args: any[]) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }
  private fire(event: string, ...args: any[]) {
    this.listeners.get(event)?.forEach((fn) => fn(...args));
  }
  connect() {
    this.active = true;
    queueMicrotask(() => {
      if (this.active) this.fire("connect");
    });
    return this;
  }
  disconnect() {
    this.active = false;
    clearInterval(this.timer);
    if (this.channel && this.client)
      void this.client.removeChannel(this.channel);
    this.channel = undefined;
    this.session = undefined;
    this.version = -1;
    return this;
  }
  removeAllListeners() {
    this.listeners.clear();
    return this;
  }
  private getClient() {
    if (this.client) return this.client;
    const url = import.meta.env.VITE_SUPABASE_URL,
      key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key)
      throw Error(
        "Add the public Supabase environment variables in Vercel and redeploy.",
      );
    this.client = createClient(url, key);
    return this.client;
  }
  private async request(body: object): Promise<OnlineResponse> {
    const client = this.getClient();
    let {
      data: { session },
    } = await client.auth.getSession();
    if (!session) {
      const result = await client.auth.signInAnonymously();
      if (result.error)
        throw Error(
          "Guest sign-in failed. Enable Anonymous Sign-Ins in Supabase Authentication.",
        );
      session = result.data.session;
    }
    if (!session) throw Error("Could not create a guest session.");
    const response = await fetch("/api/game", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const result = (await response.json()) as OnlineResponse;
    if (!response.ok) {
      if (result.code === "SEAT_LOST") {
        this.fire("left");
      }
      throw Error(result.error || "Could not reach the game service.");
    }
    return result;
  }
  private publish(view?: View) {
    if (view && view.version >= this.version) {
      this.version = view.version;
      this.fire("state", view);
    }
  }
  private async refresh() {
    if (!this.session || this.refreshing || !this.active) return;
    this.refreshing = true;
    try {
      const r = await this.request({
        action: "heartbeat",
        code: this.session.code,
      });
      this.publish(r.view);
    } catch (error) {
      this.fire("error", (error as Error).message);
    } finally {
      this.refreshing = false;
    }
  }
  private watch(session: Session) {
    clearInterval(this.timer);
    if (this.channel && this.client)
      void this.client.removeChannel(this.channel);
    this.session = session;
    this.channel = this.getClient()
      .channel(`room-${session.roomId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${session.roomId}`,
        },
        () => void this.refresh(),
      )
      .subscribe();
    this.timer = setInterval(() => void this.refresh(), 15000);
  }
  emit(event: string, payload: any, callback: (reply: any) => void) {
    void this.run(event, payload)
      .then(callback)
      .catch((error) => callback({ error: (error as Error).message }));
    return this;
  }
  timeout(_ms: number) {
    return {
      emit: (
        event: string,
        payload: any,
        callback: (error: Error | null, reply: any) => void,
      ) => {
        void this.run(event, payload)
          .then((reply) => callback(null, reply))
          .catch((error) =>
            callback(null, { error: (error as Error).message }),
          );
      },
    };
  }
  private async run(event: string, payload: any) {
    if (event === "enter") {
      const r = await this.request({ action: "enter", ...payload });
      if (r.session) {
        if (this.session?.code !== r.session.code) this.version = -1;
        this.watch(r.session);
      }
      this.publish(r.view);
      return r;
    }
    if (event === "command" && this.session) {
      try {
        const r = await this.request({
          action: "command",
          code: this.session.code,
          envelope: payload,
        });
        this.publish(r.view);
        if (r.left) this.fire("left");
        return r;
      } catch (error) {
        void this.refresh();
        throw error;
      }
    }
    throw Error("Join a table first.");
  }
}
export const socket = localSocket || new CloudTransport();
