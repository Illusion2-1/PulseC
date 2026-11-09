import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const [origin, spki] = process.argv.slice(2);
if (new URL(origin).hostname !== "127.0.0.1" || !spki) throw Error("expected local QA origin and fixture certificate");
const browser = await chromium.launch({channel: "chrome", executablePath: process.env.CHROME_BIN, args: [
  "--no-proxy-server", "--webtransport-developer-mode", "--ignore-certificate-errors-spki-list=" + spki,
]});
try {
  async function join(name) {
    const p = await browser.newPage();
    p.on("console", msg => { if (msg.type() === "error") console.error(msg.text()) });
    await p.goto(origin + "/?ch=containerqa");
    await p.locator("#nick").fill(name);
    await p.locator("form .go").click();
    await p.locator(".u").first().waitFor({state:"attached"});
    return p;
  }
  const [a,b] = await Promise.all([join("Sender"), join("Reader")]);
  const msg = "compose-udp-path";
  await a.locator("textarea").fill(msg);
  await a.locator("textarea").press("Enter");
  await b.locator(".ln:not(.pend) .tx").filter({hasText: msg}).first().waitFor();
  assert.equal(await a.locator(".stat.off").count(), 0);
  console.log("PASS HTTPS page + two independent browser clients over published UDP");
} finally { await browser.close(); }
