import { expect, test } from "./support/fixtures";

// Fake getUserMedia + MediaRecorder so the whole mic → transcribe → prompt-editor
// path runs headlessly without a real microphone or the upstream Codex endpoint.
const FAKE_MEDIA = `
  const chunks = [new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" })];
  navigator.mediaDevices.getUserMedia = async () => ({
    getTracks: () => [{ stop() {} }],
  });
  class FakeMediaRecorder {
    constructor(stream, options) { this.stream = stream; this.mimeType = options?.mimeType ?? "audio/webm"; this.state = "inactive"; }
    static isTypeSupported() { return true; }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      setTimeout(() => {
        this.ondataavailable?.({ data: chunks[0] });
        this.onstop?.();
      }, 0);
    }
  }
  window.MediaRecorder = FakeMediaRecorder;
`;

test("mic button records and drops the transcript into the prompt editor", async ({ page, stack }) => {
  await page.addInitScript(FAKE_MEDIA);
  await page.route("**/api/transcribe*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "hello from the microphone" }) });
  });

  await page.goto(stack.appUrl({ session: stack.scratchSessionId, view: "chat" }));

  const editor = page.locator("prompt-editor");
  const mic = editor.getByRole("button", { name: "Record a voice message" });
  await expect(mic).toBeVisible();

  await mic.click();

  const stopRecording = editor.getByRole("button", { name: "Stop recording and transcribe" });
  await expect(stopRecording).toBeVisible();

  await stopRecording.click();

  await expect(editor.getByLabel("Message pi")).toContainText("hello from the microphone");
  await expect(mic).toBeVisible();
});

test("a transcription failure surfaces in the editor instead of silently dropping", async ({ page, stack }) => {
  await page.addInitScript(FAKE_MEDIA);
  await page.route("**/api/transcribe*", async (route) => {
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Sign in to ChatGPT (Codex Subscription) to use voice transcription." }) });
  });

  await page.goto(stack.appUrl({ session: stack.scratchSessionId, view: "chat" }));

  const editor = page.locator("prompt-editor");
  await editor.getByRole("button", { name: "Record a voice message" }).click();
  await editor.getByRole("button", { name: "Stop recording and transcribe" }).click();

  await expect(editor.getByRole("alert")).toContainText("Sign in to ChatGPT");
});
