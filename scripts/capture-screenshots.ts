#!/usr/bin/env -S npx tsx
/**
 * Captures the desktop, tablet, and mobile PI WEB screenshots for docs/assets
 * from an isolated temporary instance, driven through the real UI with
 * Playwright's bundled Chromium (CHROME_BIN / --chrome-bin overrides the
 * browser binary).
 */
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Locator, type Page } from "@playwright/test";
import { DEMO_FILE, startPiWebStack, type PiWebStack } from "../e2e/support/stack";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_OUTPUT_DIR = join(REPO_ROOT, "docs", "assets");
const DEFAULT_SITE_URL = "https://pi-web.dev/";
const VIEWPORTS = {
  website: { width: 1280, height: 720 },
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 },
};

interface CliArgs {
  outputDir?: string;
  siteUrl?: string;
  keepTemp?: boolean;
  chromeBin?: string;
}

const args = parseArgs(process.argv.slice(2));
const outputDir = resolve(args.outputDir ?? DEFAULT_OUTPUT_DIR);
const keepTemp = args.keepTemp === true;
const siteUrl = args.siteUrl ?? DEFAULT_SITE_URL;
const envChromeBin = process.env["CHROME_BIN"];
const chromeBin = args.chromeBin ?? (envChromeBin !== undefined && envChromeBin !== "" ? envChromeBin : undefined);

let stack: PiWebStack | undefined;
let browser: Browser | undefined;
let cleanedUp = false;

process.once("SIGINT", () => {
  void cleanup().finally(() => process.exit(130));
});
process.once("SIGTERM", () => {
  void cleanup().finally(() => process.exit(143));
});

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  console.log("Starting isolated PI WEB session daemon, API server, and Vite client…");
  stack = await startPiWebStack({ project: "clone", keepTemp });
  console.log(`Temporary workspace: ${stack.tempRoot}`);

  console.log("Starting Chromium and capturing screenshots…");
  browser = await chromium.launch(chromeBin === undefined ? {} : { executablePath: chromeBin });

  await captureWebsiteScreenshot(browser, join(stack.projectDir, DEMO_FILE), siteUrl);

  const appUrl = stack.appUrl({ session: stack.demoSessionId, view: "chat" });
  await captureDesktop(browser, appUrl, join(outputDir, "pi-web-desktop.png"));
  await captureDefaultApp(browser, appUrl, VIEWPORTS.tablet, false, join(outputDir, "pi-web-tablet.png"));
  await captureDefaultApp(browser, appUrl, VIEWPORTS.mobile, true, join(outputDir, "pi-web-mobile.png"));

  if (keepTemp) console.log(`Kept temporary workspace: ${stack.tempRoot}`);
}

async function captureWebsiteScreenshot(activeBrowser: Browser, outputPath: string, url: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const context = await activeBrowser.newContext({ viewport: VIEWPORTS.website });
  const page = await context.newPage();
  try {
    await page.goto(url, { timeout: 20_000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
    }).catch(() => undefined);
    await page.waitForTimeout(3500);
    await page.screenshot({ path: outputPath });
  } catch (error) {
    console.warn(`Unable to capture ${url}; using a local fallback image. ${error instanceof Error ? error.message : String(error)}`);
    await page.setContent(fallbackWebsiteHtml(url));
    await page.waitForTimeout(300);
    await page.screenshot({ path: outputPath });
  } finally {
    await context.close();
  }
}

async function captureDesktop(activeBrowser: Browser, appUrl: string, outputPath: string): Promise<void> {
  const context = await activeBrowser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  try {
    await page.goto(appUrl, { timeout: 15_000 });
    await waitForSeededTranscript(page);
    await stageFilesPreview(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: outputPath });
    console.log(`Wrote ${outputPath}`);
  } finally {
    await context.close();
  }
}

async function captureDefaultApp(
  activeBrowser: Browser,
  appUrl: string,
  viewport: { width: number; height: number },
  mobile: boolean,
  outputPath: string,
): Promise<void> {
  const context = await activeBrowser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  try {
    await page.goto(appUrl, { timeout: 15_000 });
    await waitForSeededTranscript(page);
    await page.waitForTimeout(700);
    await page.screenshot({ path: outputPath });
    console.log(`Wrote ${outputPath}`);
  } finally {
    await context.close();
  }
}

async function waitForSeededTranscript(page: Page): Promise<void> {
  await page.locator("chat-view").getByText("Showing messages").first().waitFor({ state: "visible", timeout: 15_000 });
}

/** Open the Files tool and select the demo screenshot through the real UI. */
async function stageFilesPreview(page: Page): Promise<void> {
  // The workspace panel starts collapsed; expand it, then (re)select the Files
  // tool so the file tree refreshes.
  await page.getByRole("button", { name: "Expand workspace panel" }).click();
  await page.locator("workspace-panel").getByRole("button", { name: "Files" }).click();
  const filesPanel = page.locator("workspace-files-panel");
  await clickTreeRow(filesPanel, "docs");
  await clickTreeRow(filesPanel, "assets");
  await clickTreeRow(filesPanel, "pi-web-dev-screenshot.png");
  const image = filesPanel.locator(".image-preview img");
  await image.waitFor({ state: "visible", timeout: 10_000 });
  await waitForImageLoaded(page, image);
}

async function clickTreeRow(filesPanel: Locator, name: string): Promise<void> {
  await filesPanel.locator("button.row").filter({ hasText: name }).first().click();
}

async function waitForImageLoaded(page: Page, image: Locator): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const width = await image.evaluate((element) => (element instanceof HTMLImageElement ? element.naturalWidth : 0));
    if (width > 0) return;
    if (Date.now() > deadline) throw new Error("Timed out waiting for the image preview to finish loading");
    await page.waitForTimeout(100);
  }
}

function fallbackWebsiteHtml(url: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#07121f,#2b174c);color:#f8fafc;font:24px system-ui,sans-serif}
    main{width:min(900px,calc(100vw - 80px));padding:56px;border:1px solid rgba(255,255,255,.22);border-radius:28px;background:rgba(10,16,32,.72);box-shadow:0 24px 80px rgba(0,0,0,.35)}
    h1{margin:0 0 14px;font-size:64px;letter-spacing:-.06em}.eyebrow{color:#c084fc;text-transform:uppercase;letter-spacing:.16em;font-size:14px;font-weight:700}p{line-height:1.5;color:#dbeafe}
  </style></head><body><main><div class="eyebrow">PI WEB</div><h1>pi-web.dev</h1><p>Fallback screenshot for ${escapeHtml(url)}.</p></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npm run capture:screenshots -- [--output-dir docs/assets] [--site-url https://pi-web.dev/] [--keep-temp] [--chrome-bin /path/to/chrome]\n\nCaptures desktop, tablet, and mobile PI WEB screenshots from an isolated temporary instance.`);
      process.exit(0);
    }
    if (arg === "--keep-temp") {
      parsed.keepTemp = true;
      continue;
    }
    if (arg === "--output-dir") {
      parsed.outputDir = requireValue(argv, ++i, arg);
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      parsed.outputDir = arg.slice("--output-dir=".length);
      continue;
    }
    if (arg === "--site-url") {
      parsed.siteUrl = requireValue(argv, ++i, arg);
      continue;
    }
    if (arg.startsWith("--site-url=")) {
      parsed.siteUrl = arg.slice("--site-url=".length);
      continue;
    }
    if (arg === "--chrome-bin") {
      parsed.chromeBin = requireValue(argv, ++i, arg);
      continue;
    }
    if (arg.startsWith("--chrome-bin=")) {
      parsed.chromeBin = arg.slice("--chrome-bin=".length);
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) fail(`${flag} requires a value`);
  return value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function cleanup(): Promise<void> {
  if (cleanedUp) return;
  cleanedUp = true;
  if (browser !== undefined) await browser.close().catch(() => undefined);
  if (stack !== undefined) await stack.dispose();
}

try {
  await main();
} finally {
  await cleanup();
}
