import { test } from "vitest";
import assert from "node:assert/strict";
import { History } from "../src/lib/platform/history";
import { readJSON, webStore } from "../src/lib/platform/storage";
import type { LogEntry } from "../src/lib/types";
import { memoryStore } from "./helpers";

test("storage denial at property access still allows a fresh session", () => {
  const g = globalThis as { window?: unknown };
  g.window = {
    get sessionStorage() {
      throw Error("denied");
    },
  };
  try {
    const store = webStore("sessionStorage");
    assert.deepEqual(readJSON(store, "pulsec.session", {}), {});
    assert.throws(() => new History(store).read("room"), /denied/);
  } finally {
    delete g.window;
  }
});

test("a damaged row preserves valid older history and the next sequence number", () => {
  const old: LogEntry = { text: "before refresh", kind: "chat", time: 1 };
  const next: LogEntry = { text: "next", kind: "chat", time: 2 };
  const store = memoryStore({
    "pulsec.row.room.7": JSON.stringify({ seq: 7, message: old }),
    "pulsec.row.room.8": "{",
    "pulsec.row.room.9": "null",
  });
  const history = new History(store);
  assert.deepEqual(history.read("room"), [old]);
  history.append("room", next);
  assert.equal(JSON.parse(store.get("pulsec.row.room.8")!).seq, 8);
  assert.deepEqual(history.read("room"), [old, next]);
});

test("rows wrap around a fixed ring and a merge overwrites the last row", () => {
  const store = memoryStore();
  const history = new History(store, 3);
  history.read("r");
  for (let i = 0; i < 5; i++)
    history.append("r", { kind: "chat", text: String(i), time: i });
  assert.equal(store.keys().length, 3);
  assert.deepEqual(
    history.read("r").map((m) => m.text),
    ["2", "3", "4"],
  );
  history.append("r", { kind: "presence", text: "4+", time: 5 }, true);
  assert.deepEqual(
    history.read("r").map((m) => m.text),
    ["2", "3", "4+"],
  );
  history.clear("r");
  assert.deepEqual(store.keys(), []);
});

test("a full quota evicts the oldest tenth across channels and retries", () => {
  const store = memoryStore();
  const history = new History(store);
  for (let i = 0; i < 20; i++)
    history.append(i % 2 ? "a" : "b", { kind: "chat", text: "x", time: i });
  const set = store.set;
  let failed = false;
  store.set = (key, value) => {
    if (!failed) {
      failed = true;
      const error = new Error("full");
      error.name = "QuotaExceededError";
      throw error;
    }
    set(key, value);
  };
  history.append("a", { kind: "chat", text: "new", time: 100 });
  assert.equal(store.keys().length, 19, "two of twenty evicted, one added");
  assert.equal(store.get("pulsec.row.b.0"), null, "the oldest row went first");
});
