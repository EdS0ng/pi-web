import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecorder, pickAudioFormat, type AudioFormat } from "./recorder";

const supportedTypes = new Set<string>();

class FakeMediaRecorder {
  static isTypeSupported = (mime: string): boolean => supportedTypes.has(mime);
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "";
  }

  start(): void { this.state = "recording"; }

  stop(): void {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio-chunk"], { type: this.mimeType || "audio/webm" }) });
    this.onstop?.();
  }
}

function fakeStream(): { stream: MediaStream; track: { stop: ReturnType<typeof vi.fn> } } {
  const track = { stop: vi.fn(), kind: "audio" };
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test stub exposing only getTracks(), the surface the recorder uses.
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

const WEBM: AudioFormat = { mimeType: "audio/webm;codecs=opus", ext: "webm" };

afterEach(() => {
  vi.unstubAllGlobals();
  supportedTypes.clear();
});

describe("createRecorder", () => {
  it("captures a blob with the format's extension on stop", async () => {
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    const { stream } = fakeStream();
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    const recorder = createRecorder({ getUserMedia, format: WEBM });

    await recorder.start();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });

    const result = await recorder.stop();
    expect(result.ext).toBe("webm");
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toContain("webm");
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it("releases the microphone tracks after stop", async () => {
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    const { stream, track } = fakeStream();
    const recorder = createRecorder({ getUserMedia: () => Promise.resolve(stream), format: WEBM });

    await recorder.start();
    await recorder.stop();

    expect(track.stop).toHaveBeenCalledOnce();
  });

  it("releases the microphone tracks and discards audio on cancel", async () => {
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    const { stream, track } = fakeStream();
    const recorder = createRecorder({ getUserMedia: () => Promise.resolve(stream), format: WEBM });

    await recorder.start();
    recorder.cancel();

    expect(track.stop).toHaveBeenCalledOnce();
  });

  it("rejects stop when not recording", async () => {
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    const recorder = createRecorder({ getUserMedia: () => Promise.resolve(fakeStream().stream), format: WEBM });

    await expect(recorder.stop()).rejects.toThrow(/not running/);
  });
});

describe("pickAudioFormat", () => {
  it("prefers Opus-in-WebM when supported", () => {
    supportedTypes.add("audio/webm;codecs=opus");
    supportedTypes.add("audio/mp4");
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    expect(pickAudioFormat()).toEqual({ mimeType: "audio/webm;codecs=opus", ext: "webm" });
  });

  it("falls back to mp4 when only mp4 is supported", () => {
    supportedTypes.add("audio/mp4");
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    expect(pickAudioFormat()).toEqual({ mimeType: "audio/mp4", ext: "mp4" });
  });

  it("returns the browser-choice fallback when nothing is supported", () => {
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    expect(pickAudioFormat()).toEqual({ mimeType: "", ext: "webm" });
  });
});
