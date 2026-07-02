import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractCodexAccountId, registerTranscriptionRoutes, type CodexAuthProvider } from "./transcriptionRoutes.js";

const TRANSCRIBE_URL = "https://example.test/transcribe";

function makeJwt(payload: object): string {
  const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${segment({ alg: "none", typ: "JWT" })}.${segment(payload)}.signature`;
}

const VALID_TOKEN = makeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acc-123" } });

type FetchLike = typeof fetch;
type FetchMock = ReturnType<typeof vi.fn<FetchLike>>;

let app: FastifyInstance | undefined;

async function buildTestApp(options: { token: string | undefined; fetchImpl: FetchMock }): Promise<FastifyInstance> {
  const codexAuth: CodexAuthProvider = { getAccessToken: () => Promise.resolve(options.token) };
  const instance = Fastify({ logger: false });
  registerTranscriptionRoutes(instance, { codexAuth, fetchImpl: options.fetchImpl, transcribeUrl: TRANSCRIBE_URL });
  await instance.ready();
  return instance;
}

function jsonResponseFetch(value: unknown, status = 200): FetchMock {
  return vi.fn<FetchLike>(() => Promise.resolve(new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })));
}

function postAudio(instance: FastifyInstance, payload: Buffer, query = "") {
  return instance.inject({ method: "POST", url: `/api/transcribe${query}`, headers: { "content-type": "application/octet-stream" }, payload });
}

function fetchCall(fetchMock: FetchMock, index: number): Parameters<FetchLike> {
  const call = fetchMock.mock.calls[index];
  if (call === undefined) throw new Error(`Missing fetch call ${String(index)}`);
  return call;
}

function filePartOf(init: RequestInit | undefined): File {
  const body = init?.body;
  if (!(body instanceof FormData)) throw new Error("Expected a FormData body");
  const parts = body.getAll("file");
  if (parts.length !== 1) throw new Error(`Expected exactly one file part, got ${String(parts.length)}`);
  const part = parts[0];
  if (!(part instanceof File)) throw new Error("Expected the file part to be a File");
  return part;
}

afterEach(async () => {
  await app?.close();
});

describe("POST /api/transcribe", () => {
  it("forwards audio to the upstream endpoint and returns the transcribed text", async () => {
    const fetchMock = jsonResponseFetch({ text: "hello world", asset_pointer: "sediment://x", asset_format: "webm" });
    app = await buildTestApp({ token: VALID_TOKEN, fetchImpl: fetchMock });

    const response = await postAudio(app, Buffer.from("fake-audio-bytes"));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ text: "hello world" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchCall(fetchMock, 0);
    expect(url).toBe(TRANSCRIBE_URL);
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${VALID_TOKEN}`);
    expect(headers.get("chatgpt-account-id")).toBe("acc-123");
    expect(headers.get("originator")).toBe("pi");
    expect(headers.get("user-agent")).toBeTruthy();
    // fetch must derive the multipart boundary itself.
    expect(headers.get("content-type")).toBeNull();

    // filePartOf asserts exactly one `file` part.
    const file = filePartOf(init);
    expect(file.name).toBe("audio.webm");
    expect(file.type).toBe("audio/webm");
    expect(file.size).toBe("fake-audio-bytes".length);
  });

  it("advertises the requested extension when it is in the allowlist", async () => {
    const fetchMock = jsonResponseFetch({ text: "ok" });
    app = await buildTestApp({ token: VALID_TOKEN, fetchImpl: fetchMock });

    await postAudio(app, Buffer.from("bytes"), "?ext=wav");

    const file = filePartOf(fetchCall(fetchMock, 0)[1]);
    expect(file.name).toBe("audio.wav");
    expect(file.type).toBe("audio/wav");
  });

  it("returns 401 with a sign-in message when not authenticated and never calls upstream", async () => {
    const fetchMock = jsonResponseFetch({ text: "unused" });
    app = await buildTestApp({ token: undefined, fetchImpl: fetchMock });

    const response = await postAudio(app, Buffer.from("bytes"));

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: string }>().error).toMatch(/sign in/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps an upstream 401 to a 401 session-expired response", async () => {
    const fetchMock = vi.fn<FetchLike>(() => Promise.resolve(new Response("", { status: 401 })));
    app = await buildTestApp({ token: VALID_TOKEN, fetchImpl: fetchMock });

    const response = await postAudio(app, Buffer.from("bytes"));

    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: string }>().error).toMatch(/expired/i);
  });

  it("maps an upstream 500 to a 502", async () => {
    const fetchMock = vi.fn<FetchLike>(() => Promise.resolve(new Response("boom", { status: 500 })));
    app = await buildTestApp({ token: VALID_TOKEN, fetchImpl: fetchMock });

    const response = await postAudio(app, Buffer.from("bytes"));

    expect(response.statusCode).toBe(502);
  });

  it("returns 502 when the upstream response has no text field", async () => {
    const fetchMock = jsonResponseFetch({ asset_format: "webm" });
    app = await buildTestApp({ token: VALID_TOKEN, fetchImpl: fetchMock });

    const response = await postAudio(app, Buffer.from("bytes"));

    expect(response.statusCode).toBe(502);
  });

  it("returns 400 for an empty body and never calls upstream", async () => {
    const fetchMock = jsonResponseFetch({ text: "unused" });
    app = await buildTestApp({ token: VALID_TOKEN, fetchImpl: fetchMock });

    const response = await postAudio(app, Buffer.alloc(0));

    expect(response.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("extractCodexAccountId", () => {
  it("reads the chatgpt_account_id claim from a valid token", () => {
    expect(extractCodexAccountId(VALID_TOKEN)).toBe("acc-123");
  });

  it("throws on a token that is not a three-segment JWT", () => {
    expect(() => extractCodexAccountId("not.a-jwt")).toThrow(/three segments/);
  });

  it("throws when the account id claim is missing", () => {
    const token = makeJwt({ "https://api.openai.com/auth": { some_other: "value" } });
    expect(() => extractCodexAccountId(token)).toThrow(/chatgpt_account_id/);
  });
});
