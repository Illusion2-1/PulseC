import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  chooseLocale,
  displayEvent,
  isWarning,
  messages,
  translator,
} from "../src/lib/messages.js";

test("locale negotiation respects explicit choice, then supported browser languages", () => {
  assert.equal(chooseLocale("en", ["zh-CN"]), "en");
  assert.equal(chooseLocale(null, ["fr", "en-GB"]), "en");
  assert.equal(chooseLocale("bogus", ["de"]), "zh-CN");
});

test("each locale contains the same interpolation fields and protocol error codes", () => {
  const fields = (text) =>
    [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [code, values] of Object.entries(messages)) {
    assert.equal(values.length, 2, code);
    assert.ok(values.every(Boolean), code);
    assert.deepEqual(fields(values[0]), fields(values[1]), code);
  }
  const samples = JSON.parse(
    readFileSync(new URL("../../testdata/protocol.json", import.meta.url)),
  );
  for (const { event } of samples) {
    if (event.code) assert.ok(Object.hasOwn(messages, event.code), event.code);
  }
});

test("stored notices reflect the current locale, preserve user input and legacy text", () => {
  const en = translator("en");
  const zh = translator("zh-CN");
  const notice = {
    code: "recipient_offline",
    text: "收件人不在线",
    unsent: "中文",
  };
  assert.equal(
    displayEvent(en, notice),
    "Recipient is offline · Not sent: 中文",
  );
  assert.equal(displayEvent(zh, notice), "收件人不在线 · 未发送：中文");
  assert.equal(displayEvent(en, { text: "old text" }), "old text");
  assert.equal(
    displayEvent(en, { code: "toString", text: "future" }),
    "future",
  );
  assert.equal(
    displayEvent(en, {
      parts: [
        { text: "+ old" },
        { code: "memberLeave", params: { name: "Nick#abc" } },
      ],
    }),
    "+ old   Nick#abc left",
  );
});

test("failure notices are recognised for the red !! marker", () => {
  assert.equal(isWarning({ code: "recipient_offline" }), true);
  assert.equal(isWarning({ code: "unknownCommand" }), true);
  assert.equal(isWarning({ warn: true }), true);
  assert.equal(isWarning({ code: "help" }), false);
  assert.equal(isWarning({ code: "joinedRoom" }), false);
  assert.equal(isWarning({ text: "legacy" }), false);
});
