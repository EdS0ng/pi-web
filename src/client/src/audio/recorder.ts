// Microphone capture for the composer's voice-to-text button. The spike confirmed
// the server accepts webm/opus, so we ship MediaRecorder as-is (no WAV encoder).
// The Recorder interface is intentionally swappable so a different backing encoder
// could be dropped in without touching the UI.

export interface RecordedAudio {
  /** The recorded audio; its `type` is the MediaRecorder mime. */
  blob: Blob;
  /** File extension advertised to the server (`webm` | `mp4`), matching the mime. */
  ext: string;
}

export interface Recorder {
  /** Acquire the mic and begin recording. Rejects if permission is denied. */
  start(): Promise<void>;
  /** Stop recording, release the mic, and resolve with the captured audio. */
  stop(): Promise<RecordedAudio>;
  /** Abort recording, discard audio, and release the mic. Safe to call any time. */
  cancel(): void;
}

export interface AudioFormat {
  /** A MediaRecorder mime, or "" to let the browser choose. */
  mimeType: string;
  ext: string;
}

export interface RecorderDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** Force a format (used by tests); otherwise picked from MediaRecorder support. */
  format?: AudioFormat;
}

// Preference order: Opus-in-WebM (Chrome/Firefox), plain WebM, then MP4 (Safari).
const CANDIDATE_FORMATS: readonly AudioFormat[] = [
  { mimeType: "audio/webm;codecs=opus", ext: "webm" },
  { mimeType: "audio/webm", ext: "webm" },
  { mimeType: "audio/mp4", ext: "mp4" },
];

const FALLBACK_FORMAT: AudioFormat = { mimeType: "", ext: "webm" };

/** Choose the best MediaRecorder mime this browser supports, with its file extension. */
export function pickAudioFormat(): AudioFormat {
  const supports = typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function"
    ? (mime: string) => MediaRecorder.isTypeSupported(mime)
    : () => false;
  for (const format of CANDIDATE_FORMATS) {
    if (supports(format.mimeType)) return format;
  }
  return FALLBACK_FORMAT;
}

export function createRecorder(deps: RecorderDeps = {}): Recorder {
  const getUserMedia = deps.getUserMedia ?? defaultGetUserMedia;
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let format: AudioFormat = deps.format ?? FALLBACK_FORMAT;
  const chunks: Blob[] = [];

  function releaseTracks(): void {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = undefined;
  }

  return {
    async start(): Promise<void> {
      if (recorder !== undefined) return;
      format = deps.format ?? pickAudioFormat();
      stream = await getUserMedia({ audio: true });
      const options = format.mimeType === "" ? undefined : { mimeType: format.mimeType };
      const mediaRecorder = new MediaRecorder(stream, options);
      chunks.length = 0;
      mediaRecorder.ondataavailable = (event: BlobEvent) => { if (event.data.size > 0) chunks.push(event.data); };
      mediaRecorder.start();
      recorder = mediaRecorder;
    },

    stop(): Promise<RecordedAudio> {
      return new Promise<RecordedAudio>((resolve, reject) => {
        const mediaRecorder = recorder;
        if (mediaRecorder === undefined) { reject(new Error("Recorder is not running")); return; }
        mediaRecorder.onstop = () => {
          recorder = undefined;
          releaseTracks();
          const type = mediaRecorder.mimeType !== "" ? mediaRecorder.mimeType : (format.mimeType !== "" ? format.mimeType : "audio/webm");
          resolve({ blob: new Blob(chunks, { type }), ext: format.ext });
        };
        mediaRecorder.onerror = () => {
          recorder = undefined;
          releaseTracks();
          reject(new Error("Recording failed"));
        };
        mediaRecorder.stop();
      });
    },

    cancel(): void {
      const mediaRecorder = recorder;
      recorder = undefined;
      if (mediaRecorder !== undefined && mediaRecorder.state !== "inactive") {
        mediaRecorder.ondataavailable = null;
        mediaRecorder.onstop = null;
        try { mediaRecorder.stop(); } catch { /* already stopped */ }
      }
      chunks.length = 0;
      releaseTracks();
    },
  };
}

function defaultGetUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  // navigator.mediaDevices is typed as always-present but is genuinely undefined on
  // insecure (http, non-localhost) origins, so launder it through an optional type.
  const mediaDevices: MediaDevices | undefined = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (mediaDevices === undefined) {
    return Promise.reject(new Error("Microphone access is not available in this browser."));
  }
  return mediaDevices.getUserMedia(constraints);
}
