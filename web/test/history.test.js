import { test } from "node:test";
import assert from "node:assert/strict";
import { readRows, appendRow } from "../src/lib/history.js";
import { readSaved } from "../src/lib/session.js";

test("storage denial at property access still allows a fresh session", () => {
  globalThis.window = {
    get sessionStorage() {
      throw Error("denied");
    },
  };
  try {
    assert.deepEqual(readSaved("sessionStorage", "pulsec.session", {}), {});
  } finally {
    delete globalThis.window;
  }
});

test("a damaged row preserves valid older history and the next sequence number", () => {
  const old = { text: "before refresh", kind: "chat", time: 1 };
  const next = { text: "next", kind: "chat", time: 2 };
  globalThis.sessionStorage = {
    "pulsec.row.room.7": JSON.stringify({ seq: 7, message: old }),
    "pulsec.row.room.8": "{",
    "pulsec.row.room.9": "null",
    getItem(key) {
      return this[key];
    },
    setItem(key, value) {
      this[key] = value;
    },
  };
  try {
    assert.deepEqual(readRows("room"), [old]);
    appendRow("room", next);
    assert.equal(
      JSON.parse(sessionStorage.getItem("pulsec.row.room.8")).seq,
      8,
    );
    assert.deepEqual(readRows("room"), [old, next]);
  } finally {
    delete globalThis.sessionStorage;
  }
});
