/**
 * Webhook receiver for asynchronous `request_input` replies pushed by the
 * external inbox server. Authenticates with a shared secret (the daemon proxy
 * does not forward headers, so the check must live here on the web server),
 * then forwards to sessiond's per-session reply route and relays its status
 * verbatim — the inbox uses 404 to stop retrying, 409 for archived sessions,
 * and 502 to retry later.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { SessionProxyDaemon } from "./sessiond/sessionProxyRoutes.js";

export const REQUEST_INPUT_SECRET_HEADER = "x-request-input-secret";

export interface RequestInputWebhookOptions {
  /** Shared secret; undefined or empty disables the webhook (route replies 404). */
  secret?: string | undefined;
}

export function registerRequestInputWebhookRoutes(app: FastifyInstance, daemon: SessionProxyDaemon, options: RequestInputWebhookOptions = {}, prefix = "/api"): void {
  app.post(`${prefix}/request-input/reply`, async (request, reply) => {
    const secret = options.secret;
    if (secret === undefined || secret === "") return reply.code(404).send({ error: "request_input webhook is not enabled" });

    const provided = request.headers[REQUEST_INPUT_SECRET_HEADER];
    if (typeof provided !== "string" || !constantTimeEquals(provided, secret)) {
      return reply.code(401).send({ error: "invalid webhook secret" });
    }

    const body = request.body;
    if (!isRecord(body)) return reply.code(400).send({ error: "request body must be a JSON object" });
    const sessionId = body["sessionId"];
    if (typeof sessionId !== "string" || sessionId === "") return reply.code(400).send({ error: "sessionId field must be a non-empty string" });

    try {
      const upstream = await daemon.request("POST", `/sessions/${encodeURIComponent(sessionId)}/request-input/reply`, body);
      reply.code(upstream.statusCode);
      const contentType = upstream.headers["content-type"];
      if (contentType !== undefined && contentType !== "") reply.header("content-type", contentType);
      return upstream.body !== "" ? parseJson(upstream.body) : undefined;
    } catch (error) {
      return reply.code(502).send({ error: `Session daemon unavailable: ${error instanceof Error ? error.message : String(error)}` });
    }
  });
}

/** Length-hiding constant-time comparison (hash both sides, then timingSafeEqual). */
function constantTimeEquals(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
