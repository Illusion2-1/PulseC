import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

// Run only against our local child. The old binary is optional for rollback drills.
const here = fileURLToPath(new URL(".", import.meta.url));
const binary = resolve(process.env.PULSEC_BIN ?? here + "../dist/pulsec");
const base = Number(process.env.QA_PORT ?? 18487);
const origin = (port) => "http://127.0.0.1:" + port;
const children = [];
const errors = [];
let browser;
function start(exe, args) {
  const proc = spawn(exe, args, { cwd: here, stdio: ["ignore", "ignore", "pipe"] });
  proc.stderr.on("data", () => {}); // Never persist browser traffic or credentials.
  children.push(proc);
  return proc;
}
async function stop(p) {
  if (!p || p.exitCode !== null || p.signalCode !== null) return;
  const exited = once(p, "exit");
  p.kill();
  await exited;
}
async function ready(p, port) {
  for (let i = 0; i < 80; i++) {
    if (p.exitCode !== null || p.signalCode !== null) throw Error("child exited during startup");
    try { if ((await fetch(origin(port) + "/config", { signal: AbortSignal.timeout(400) })).ok) return; } catch {}
    await sleep(75);
  }
  throw Error("listener did not start");
}
async function relay(exe) {
  const p = start(exe, ["-addr", "127.0.0.1:" + base]);
  await ready(p, base);
  return p;
}
async function page(name, locale = "en", endpoint = base + 1, width = 960) {
  const ctx = await browser.newContext({ locale, viewport: {width, height: 800} });
  const p = await ctx.newPage();
  p.on("pageerror", (err) => errors.push(err.message));
  p.setDefaultTimeout(20000);
  await p.goto(origin(endpoint) + "/?ch=qa");
  await p.locator("#nick").fill(name);
  await p.locator("form .go").click();
  return p;
}
async function send(p, msg) {
  const area = p.locator("textarea");
  await area.fill(msg);
  await area.press("Enter");
}
const messages = (p) => p.locator(".ln:not(.sys):not(.pend) .tx");
async function drained(p) {
  await p.waitForFunction(() => JSON.parse(sessionStorage.getItem("pulsec.session"))?.queue?.length === 0);
}
async function sees(p, text) {
  await messages(p).filter({hasText: text}).first().waitFor();
}
try {
  let server = await relay(binary);
  const proxy = start("python3", ["impair.py", String(base + 1), String(base)]);
  await ready(proxy, base + 1);
  const blocked = start("python3", ["impair.py", String(base + 2), String(base), "--block"]);
  await ready(blocked, base + 2);
  browser = await chromium.launch({ channel: "chrome", executablePath: process.env.CHROME_BIN,
    args: ["--no-proxy-server"], headless: true });
  const alice = await page("Alice");
  await alice.locator(".head").getByText("WebTransport · TLS 1.3", {exact: true}).waitFor();
  const bob = await page("Bob", "zh-CN", base + 1, 360);
  await alice.waitForFunction(() => document.querySelectorAll(".u").length === 2);
  for (let i = 0; i < 6; i++) await send(alice, "release-check-" + i);
  await sees(bob, "release-check-5");
  assert.deepEqual(await messages(bob).allTextContents(), Array.from({length: 6}, (_, i) => "release-check-" + i));
  await drained(alice);
  await alice.waitForFunction(() => document.querySelector(".meter")?.textContent.trim() === "▯▯▯▯▯▯");
  await send(alice, "held-by-rate-limit");
  assert.equal(await alice.locator("textarea").inputValue(), "held-by-rate-limit");
  await alice.locator(".input.throt").waitFor();
  assert.equal(await alice.locator(".pend").count(), 0);
  await alice.locator("textarea").fill("");
  console.log("PASS seventh message before cooldown stays in the draft");
  const late = await page("Late");
  await late.locator(".u").first().waitFor();
  await send(bob, "/w Alice private-probe");
  await sees(alice, "private-probe");
  await send(bob, "public-barrier");
  await sees(late, "public-barrier");
  assert.deepEqual(await messages(late).allTextContents(), ["public-barrier"]);
  await bob.reload();
  await bob.locator(".u").first().waitFor({state: "attached"});
  await sees(bob, "release-check-0");
  assert(await bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  console.log("PASS weak link: complete, ordered, private, no backlog; refresh and 360px layout");
  if (!process.env.QA_LEGACY_UI) {
    assert.equal(await bob.locator("html").getAttribute("lang"), "zh-CN");
    assert.equal(await alice.locator("html").getAttribute("lang"), "en");
    await bob.locator('select[aria-label="Language / 语言"]').selectOption("en");
    assert.equal(await bob.locator("html").getAttribute("lang"), "en");
    await sees(bob, "release-check-0");
    console.log("PASS bilingual session and language switch");
  }
  await stop(server);
  await bob.locator(".stat.off").waitFor({ timeout: 70000 });
  await send(bob, "queued-while-offline");
  server = await relay(binary);
  await sees(bob, "queued-while-offline");
  await drained(bob);
  assert.equal(await messages(bob).filter({hasText: "queued-while-offline"}).count(), 1);
  // The page remains reachable when only UDP is blocked.
  const noUDP = await browser.newPage({locale: "en"});
  await noUDP.goto(origin(base + 2));
  await noUDP.locator("form .go").waitFor();
  await (process.env.QA_LEGACY_UI ? noUDP.locator(".head").getByText(/断线/) : noUDP.locator(".net-hint")).first().waitFor({timeout: 45000});
  assert(await noUDP.locator("form .go").isDisabled());
  assert.equal(await noUDP.locator(".u").count(), 0);
  await noUDP.close();
  console.log("PASS candidate explains blocked UDP");
  if (process.env.ROLLBACK_BIN) {
    await stop(server);
    await Promise.all([alice, bob].map(p => p.locator(".stat.off").waitFor({timeout: 70000})));
    server = await relay(resolve(process.env.ROLLBACK_BIN));
    // Old roster rows can remain visible offline. A rename visible to the other tab
    // is a fresh barrier from the replacement process, unlike an old member count.
    await bob.locator(".stat:not(.off)").waitFor({timeout: 65000});
    await alice.locator(".stat:not(.off)").waitFor({timeout: 65000});
    await send(bob, "/nick BackOnline");
    await alice.locator('.u[title^="BackOnline#"]').waitFor({state: "attached", timeout: 65000});
    // The six-message test can still occupy Alice's entire ten-second window.
    await alice.waitForFunction(() => document.querySelector(".meter")?.textContent.includes("▮"));
    await send(alice, "after-rollback");
    assert.equal(await alice.locator("textarea").inputValue(), "", "Alice accepted the draft");
    await Promise.all([sees(alice, "after-rollback"), sees(bob, "after-rollback"), drained(alice)]);
  }
  console.log("PASS restart, offline queue" + (process.env.ROLLBACK_BIN ? ", rollback" : ""));
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  for (const child of children.reverse()) await stop(child);
}
