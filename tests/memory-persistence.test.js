const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const appDirectory = path.join(root, "daytone");
const photoPath = path.join(__dirname, "fixtures", "memory-photo.jpg");
const audioPath = path.join(__dirname, "fixtures", "memory-soundtrack.wav");
const chromiumPath = process.env.CHROMIUM_PATH
  || (existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined);

let server;
let browser;
let page;
let appUrl;

async function unusedPort() {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const { port } = reservation.address();
  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The local server may need a moment to bind.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The local DAYTONE test server did not start.");
}

async function waitForArchive() {
  await page.waitForFunction(() => {
    const archive = document.querySelector("#archive-content");
    return archive?.getAttribute("aria-busy") === "false";
  });
}

async function openSavedMemory() {
  await page.locator(".memory-card [data-action='view']").click();
  await page.locator("#memory-dialog[open]").waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector("#presentation-image");
    return image && !image.hidden && image.complete && image.naturalWidth > 0;
  });
  await page.waitForFunction(() => {
    const audio = document.querySelector("#presentation-audio");
    return audio && audio.readyState >= HTMLMediaElement.HAVE_METADATA && Number.isFinite(audio.duration);
  });
  assert.match(await page.locator("#presentation-audio").getAttribute("src"), /^blob:/);
}

async function verifyMemory({ title, note, track }) {
  await assert.doesNotReject(openSavedMemory());
  assert.equal(await page.locator("#presentation-title").textContent(), title);
  assert.equal(await page.locator("#presentation-story").textContent(), note);
  assert.equal(await page.locator("#presentation-track").textContent(), track);
  assert.equal(await page.locator("#presentation-image").getAttribute("alt"), "memory-photo.jpg");
  assert.ok(Number(await page.locator("#presentation-progress").getAttribute("max")) > 0,
    "the saved soundtrack excerpt should have a playable duration");

  await page.locator("#presentation-play").click();
  await page.waitForFunction(() => document.querySelector("#presentation-play")?.getAttribute("aria-pressed") === "true");
  const playback = await page.locator("#presentation-audio").evaluate((audio) => ({
    currentTime: audio.currentTime,
    duration: audio.duration,
  }));
  assert.ok(playback.currentTime >= 0 && playback.currentTime < playback.duration,
    "playback should start within the saved soundtrack excerpt");
  await page.locator("#presentation-play").click();
  await page.locator("#presentation-close").click();
  await page.locator("#memory-dialog").waitFor({ state: "hidden" });
}

before(async () => {
  const port = await unusedPort();
  appUrl = `http://127.0.0.1:${port}/`;
  server = spawn("python3", [
    "-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", appDirectory,
  ], { stdio: "ignore" });
  await waitForServer(appUrl);

  browser = await chromium.launch({
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext();
  page = await context.newPage();
});

after(async () => {
  await browser?.close();
  server?.kill("SIGTERM");
});

test("memories keep photos, notes, and soundtrack when created, edited, or deleted across reloads", {
  timeout: 90000,
}, async () => {
  await page.goto(appUrl);
  await waitForArchive();
  await page.locator("#create-memory-button").click();
  await page.locator("#memory-title").fill("A test day");
  await page.locator("#memory-text").fill("A note that should stay in the diary.");
  await page.locator("#story-next").click();
  await page.locator("#photo-files").setInputFiles(photoPath);
  await page.waitForFunction(() => {
    const image = document.querySelector("#photo-grid img");
    return image?.complete && image.naturalWidth > 0;
  });
  await page.locator("#frames-next").click();
  await page.locator("#audio-file").setInputFiles(audioPath);
  await page.waitForFunction(() => {
    const player = document.querySelector("#local-audio-player");
    return player && player.readyState >= HTMLMediaElement.HAVE_METADATA
      && Number.isFinite(player.duration) && player.duration > 0;
  });
  await page.locator("#local-track-title").fill("Test soundtrack");
  await page.locator("#save-button").click();
  await page.locator(".memory-card").waitFor();
  assert.equal(await page.locator(".memory-card-title").textContent(), "A test day");

  await page.reload();
  await waitForArchive();
  await verifyMemory({
    title: "A test day",
    note: "A note that should stay in the diary.",
    track: "Test soundtrack",
  });

  await page.locator(".memory-card [data-action='edit']").click();
  await page.locator("#create-screen:not([hidden])").waitFor();
  assert.equal(await page.locator("#memory-text").inputValue(), "A note that should stay in the diary.");
  await page.locator("#memory-title").fill("An edited test day");
  await page.locator("#memory-text").fill("The edited note still belongs with its photo and song.");
  await page.locator("#story-next").click();
  await page.locator("#frames-next").click();
  await page.locator("#save-button").click();
  await page.getByRole("heading", { name: "An edited test day" }).waitFor();

  await page.reload();
  await waitForArchive();
  await verifyMemory({
    title: "An edited test day",
    note: "The edited note still belongs with its photo and song.",
    track: "Test soundtrack",
  });

  await page.reload();
  await waitForArchive();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".memory-card [data-action='delete']").click();
  await page.locator(".empty-state").waitFor();
  await page.reload();
  await waitForArchive();
  assert.equal(await page.locator(".memory-card").count(), 0);
  assert.match(await page.locator(".empty-state h3").textContent(), /Nothing held here yet/);
});

test("a failed IndexedDB write keeps the complete draft available for retry", {
  timeout: 90000,
}, async () => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.__failNextDiaryWrite = true;
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (window.__failNextDiaryWrite) {
        window.__failNextDiaryWrite = false;
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      return originalPut.apply(this, args);
    };
  });
  const failurePage = await context.newPage();

  try {
    await failurePage.goto(appUrl);
    await failurePage.waitForFunction(() => {
      const archive = document.querySelector("#archive-content");
      return archive?.getAttribute("aria-busy") === "false";
    });
    await failurePage.locator("#create-memory-button").click();
    await failurePage.locator("#memory-title").fill("A day worth keeping");
    await failurePage.locator("#memory-text").fill("The note stays here while storage is full.");
    await failurePage.locator("#story-next").click();
    await failurePage.locator("#photo-files").setInputFiles(photoPath);
    await failurePage.waitForFunction(() => {
      const image = document.querySelector("#photo-grid img");
      return image?.complete && image.naturalWidth > 0;
    });
    await failurePage.locator("#frames-next").click();
    await failurePage.locator("#audio-file").setInputFiles(audioPath);
    await failurePage.waitForFunction(() => {
      const player = document.querySelector("#local-audio-player");
      return player && player.readyState >= HTMLMediaElement.HAVE_METADATA
        && Number.isFinite(player.duration) && player.duration > 0;
    });
    await failurePage.locator("#local-track-title").fill("The song from that day");
    await failurePage.locator("#save-button").click();

    const message = failurePage.locator("#form-message");
    await message.getByText(/out of storage space/i).waitFor();
    assert.equal(await message.evaluate((element) => element.classList.contains("is-error")), true);
    assert.equal(await failurePage.locator("#memory-title").inputValue(), "A day worth keeping");
    assert.equal(await failurePage.locator("#memory-text").inputValue(), "The note stays here while storage is full.");
    assert.equal(await failurePage.locator("#local-track-title").inputValue(), "The song from that day");
    assert.equal(await failurePage.locator("#photo-grid img").getAttribute("alt"), "memory-photo.jpg");
    assert.equal(await failurePage.locator("#local-audio-player").isVisible(), true);
    assert.equal(await failurePage.locator("#save-button").isEnabled(), true);

    await failurePage.evaluate(() => { window.__failNextDiaryWrite = false; });
    await failurePage.locator("#save-button").click();
    await failurePage.getByRole("heading", { name: "A day worth keeping" }).waitFor();
    assert.match(await failurePage.locator(".memory-track").textContent(), /The song from that day/);

    await failurePage.locator(".memory-card [data-action='edit']").click();
    await failurePage.locator("#create-screen:not([hidden])").waitFor();
    await failurePage.locator("#memory-title").fill("An edited day worth keeping");
    await failurePage.locator("#memory-text").fill("The edited note must survive the failed write.");
    await failurePage.locator("#story-next").click();
    await failurePage.locator("#frames-next").click();
    await failurePage.locator("#local-track-title").fill("The edited song from that day");
    await failurePage.evaluate(() => { window.__failNextDiaryWrite = true; });
    await failurePage.locator("#save-button").click();

    await message.getByText(/out of storage space/i).waitFor();
    assert.equal(await failurePage.locator("#memory-title").inputValue(), "An edited day worth keeping");
    assert.equal(await failurePage.locator("#memory-text").inputValue(), "The edited note must survive the failed write.");
    assert.equal(await failurePage.locator("#local-track-title").inputValue(), "The edited song from that day");
    assert.equal(await failurePage.locator("#photo-grid img").getAttribute("alt"), "memory-photo.jpg");
    assert.equal(await failurePage.locator("#local-audio-player").isVisible(), true);

    await failurePage.evaluate(() => { window.__failNextDiaryWrite = false; });
    await failurePage.locator("#save-button").click();
    await failurePage.getByRole("heading", { name: "An edited day worth keeping" }).waitFor();
    assert.match(await failurePage.locator(".memory-track").textContent(), /The edited song from that day/);
  } finally {
    await context.close();
  }
});
