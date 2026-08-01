import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerRequestInputWebhookRoutes, REQUEST_INPUT_SECRET_HEADER } from "./requestInputWebhookRoutes.js";
import type { SessionProxyDaemon } from "./sessiond/sessionProxyRoutes.js";

interface DaemonCall {
  method: string;
  path: string;
  body: unknown;
}

function fakeDaemon(respond: () => { statusCode: number; headers: Record<string, string>; body: string }) {
  const calls: DaemonCall[] = [];
  const daemon: SessionProxyDaemon = {
    request: (method, path, body) => {
      calls.push({ method, path, body });
      return Promise.resolve(respond());
    },
    connectWebSocket: () => {
      throw new Error("not used");
    },
  };
  return { daemon, calls };
}

const REPLY_BODY = {
  kind: "request_input.reply",
  version: 1,
  requestId: "req-1",
  sessionId: "sess/1",
  answer: "yes",
  answeredBy: "user",
  answeredAt: "2026-07-17T00:00:00.000Z",
};

let app: FastifyInstance | undefined;

function buildWebhookApp(daemon: SessionProxyDaemon, secret: string | undefined): FastifyInstance {
  app = Fastify({ logger: false });
  registerRequestInputWebhookRoutes(app, daemon, { secret });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("request_input webhook routes", () => {
  it("replies 404 when no secret is configured (feature off), without touching the daemon", async () => {
    const { daemon, calls } = fakeDaemon(() => ({ statusCode: 200, headers: {}, body: "{}" }));
    const webhookApp = buildWebhookApp(daemon, undefined);

    const response = await webhookApp.inject({
      method: "POST",
      url: "/api/request-input/reply",
      headers: { [REQUEST_INPUT_SECRET_HEADER]: "anything" },
      payload: REPLY_BODY,
    });

    expect(response.statusCode).toBe(404);
    expect(calls).toEqual([]);
  });

  it("replies 401 on a missing or wrong secret", async () => {
    const { daemon, calls } = fakeDaemon(() => ({ statusCode: 200, headers: {}, body: "{}" }));
    const webhookApp = buildWebhookApp(daemon, "topsecret");

    const missing = await webhookApp.inject({ method: "POST", url: "/api/request-input/reply", payload: REPLY_BODY });
    const wrong = await webhookApp.inject({
      method: "POST",
      url: "/api/request-input/reply",
      headers: { [REQUEST_INPUT_SECRET_HEADER]: "nope" },
      payload: REPLY_BODY,
    });

    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(calls).toEqual([]);
  });

  it("replies 400 on a body without sessionId", async () => {
    const { daemon, calls } = fakeDaemon(() => ({ statusCode: 200, headers: {}, body: "{}" }));
    const webhookApp = buildWebhookApp(daemon, "topsecret");

    const response = await webhookApp.inject({
      method: "POST",
      url: "/api/request-input/reply",
      headers: { [REQUEST_INPUT_SECRET_HEADER]: "topsecret" },
      payload: { requestId: "req-1", answer: "yes" },
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it("forwards to sessiond's per-session route and relays the response", async () => {
    const { daemon, calls } = fakeDaemon(() => ({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: '{"status":"delivered"}',
    }));
    const webhookApp = buildWebhookApp(daemon, "topsecret");

    const response = await webhookApp.inject({
      method: "POST",
      url: "/api/request-input/reply",
      headers: { [REQUEST_INPUT_SECRET_HEADER]: "topsecret" },
      payload: REPLY_BODY,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "delivered" });
    expect(calls).toEqual([{ method: "POST", path: "/sessions/sess%2F1/request-input/reply", body: REPLY_BODY }]);
  });

  it("relays upstream error statuses (404 unknown session)", async () => {
    const { daemon } = fakeDaemon(() => ({
      statusCode: 404,
      headers: { "content-type": "application/json" },
      body: '{"error":"Session not found"}',
    }));
    const webhookApp = buildWebhookApp(daemon, "topsecret");

    const response = await webhookApp.inject({
      method: "POST",
      url: "/api/request-input/reply",
      headers: { [REQUEST_INPUT_SECRET_HEADER]: "topsecret" },
      payload: REPLY_BODY,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Session not found" });
  });

  it("replies 502 when the daemon is unreachable", async () => {
    const daemon: SessionProxyDaemon = {
      request: () => Promise.reject(new Error("connect ECONNREFUSED")),
      connectWebSocket: () => {
        throw new Error("not used");
      },
    };
    const webhookApp = buildWebhookApp(daemon, "topsecret");

    const response = await webhookApp.inject({
      method: "POST",
      url: "/api/request-input/reply",
      headers: { [REQUEST_INPUT_SECRET_HEADER]: "topsecret" },
      payload: REPLY_BODY,
    });

    expect(response.statusCode).toBe(502);
    expect(response.json<{ error: string }>().error).toMatch(/Session daemon unavailable/);
  });
});
