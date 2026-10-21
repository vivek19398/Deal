import type { IncomingMessage, ServerResponse } from "node:http";
import {
  cloudClient,
  CloudError,
  handleOnline,
  SupabaseGameDatabase,
} from "../server/cloud.js";
export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Vary", "Authorization");
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Use POST" }));
    return;
  }
  try {
    if (Number(req.headers["content-length"] || 0) > 16000)
      throw new CloudError("Request is too large", 413);
    const token = req.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
    if (!token)
      throw new CloudError(
        "Sign in as a guest before joining a table.",
        401,
        "AUTH_REQUIRED",
      );
    const client = cloudClient();
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user)
      throw new CloudError(
        "Your guest session expired. Please reconnect.",
        401,
        "AUTH_REQUIRED",
      );
    let body = req.body;
    if (body === undefined) {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 16000)
          throw new CloudError("Request is too large", 413);
      }
      body = JSON.parse(raw);
    }
    if (typeof body === "string") body = JSON.parse(body);
    const reply = await handleOnline(
      new SupabaseGameDatabase(client),
      data.user.id,
      body,
    );
    res.statusCode = 200;
    res.end(JSON.stringify(reply));
  } catch (error) {
    const known = error instanceof CloudError;
    res.statusCode = known
      ? error.status
      : error instanceof SyntaxError
        ? 400
        : 503;
    res.end(
      JSON.stringify({
        error: known
          ? error.message
          : error instanceof SyntaxError
            ? "Invalid JSON request"
            : "Could not reach the game service. Please try again.",
        code: known ? error.code : "SERVICE_ERROR",
      }),
    );
  }
}
