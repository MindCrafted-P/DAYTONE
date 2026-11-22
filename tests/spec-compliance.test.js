const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawn, execFileSync } = require("node:child_process");
const { mkdir } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const { chromium } = require("playwright");
const net = require("node:net");

test("demo archive, explanations, portable folder and long stories work", { timeout: 120000 }, async () => {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", "daytone"], { stdio: "ignore" });
  let browser;
  try {
    const url = `http://127.0.0.1:${port}/`;
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(url)).ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined), headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.locator("#load-demo-days").click();
    await page.waitForFunction(() => document.querySelectorAll(".memory-card").length === 3);
    const types = await page.locator(".memory-card").evaluateAll((cards) => cards.map((card) => card.dataset.atmosphere));
    assert.equal(new Set(types).size, 3);
    await page.locator("#load-demo-days").click();
    await page.waitForFunction(() => !document.querySelector("#load-demo-days").disabled);
    assert.equal(await page.locator(".memory-card").count(), 3, "demo load must not duplicate or replace days");
    await page.reload();
    await page.locator(".memory-card").first().waitFor();
    await mkdir("generated-artifacts/checks", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/checks/archive-desktop.png", fullPage: true });
    await page.locator(".memory-card [data-action=view]").first().click();
    await page.locator(".atmosphere-explanation summary").click();
    assert.match(await page.locator("#presentation-explanation").textContent(), /photo\(s\).*rhythm/);
    await page.locator("#presentation-play").click();
    await page.waitForFunction(() => !document.querySelector("#presentation-audio").paused);
    await page.locator("#presentation-play").click();
    const downloadEvent = page.waitForEvent("download");
    await page.locator("#export-day").click();
    const download = await downloadEvent;
    await download.saveAs("generated-artifacts/checks/day.zip");
    const members = execFileSync("unzip", ["-Z1", "generated-artifacts/checks/day.zip"], { encoding: "utf8" }).trim().split("\n");
    assert.ok(members.some((name) => name.endsWith("/memory.html")));
    assert.ok(members.some((name) => name.endsWith("/soundtrack.wav")));
    assert.equal(members.filter((name) => name.includes("/photos/")).length, 3);
    const html = execFileSync("unzip", ["-p", "generated-artifacts/checks/day.zip", members.find((name) => name.endsWith("/memory.html"))], { maxBuffer: 10 * 1024 * 1024 }).toString();
    assert.match(html, /data:audio\/wav;base64/);
    const portable = await browser.newPage();
    await portable.setContent(html);
    assert.equal(await portable.locator("img.active").count(), 1);
    await portable.locator("#next").click();
    assert.equal(await portable.locator("img").nth(1).getAttribute("class"), "active");
    await portable.close();
    await page.screenshot({ path: "generated-artifacts/checks/day-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "generated-artifacts/checks/day-mobile.png", fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator("#presentation-close").click();
    await page.screenshot({ path: "generated-artifacts/checks/archive-mobile.png", fullPage: true });
    await page.locator("#create-memory-button").click();
    await page.locator("#story-next").click();
    assert.ok(await page.locator("#form-message").isVisible(), "validation message is visible on the story step");
    const story = "Тихий день у озера. ".repeat(40);
    await page.locator("#memory-text").fill(story);
    assert.equal(await page.locator("#memory-text").inputValue(), story);
    await page.locator("#story-next").click();
    await page.locator("#photo-files").setInputFiles("tests/fixtures/memory-photo.jpg");
    await page.locator("#frames-next").click();
    await page.locator("#audio-file").setInputFiles("tests/fixtures/memory-soundtrack.wav");
    await page.locator("#music-description").fill("slow ambient");
    await page.locator("#save-button").click();
    await page.waitForFunction(() => document.querySelectorAll(".memory-card").length === 4);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
});
