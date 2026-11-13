import { test } from "vitest";
import assert from "node:assert/strict";
import {
  restoreKnown,
  restoreLogin,
  restoreSession,
} from "../src/lib/chat/session";
import { forgetChatData } from "../src/lib/platform/storage";
import { memoryStore, trip } from "./helpers";

test("forget removes only this application's chat data", () => {
  const tab = memoryStore({
    "pulsec.session": "x",
    "pulsec.row.lobby.4": "x",
    unrelated: "x",
  });
  const local = memoryStore({
    "pulsec.channels": "x",
    "pulsec.login": "x",
    "pulsec.language": "x",
    unrelated: "x",
  });
  forgetChatData(tab, local);
  assert.deepEqual(tab.keys(), ["unrelated"]);
  assert.deepEqual(local.keys().sort(), ["pulsec.language", "unrelated"]);
});

test("remembered login preserves passwords exactly and rejects malformed data", () => {
  const login = { nick: "neo", password: " secret 中文 " };
  assert.deepEqual(restoreLogin(login), login);
  assert.deepEqual(restoreLogin({ nick: "", password: "" }), {
    nick: "",
    password: "",
  });
  for (const saved of [
    null,
    [],
    { nick: 123, password: "secret" },
    { nick: "bad name", password: "secret" },
    { nick: "n".repeat(17), password: "secret" },
    { nick: "neo", password: false },
    { nick: "neo", password: "x".repeat(257) },
  ])
    assert.equal(restoreLogin(saved), null);
});

const identity = {
  nick: "neo",
  proof: "a".repeat(64),
  trip: trip("b"),
  color: "",
};
const queued = (room: string, extra = {}) => ({
  op: "send",
  kind: "chat",
  room,
  text: "hi",
  to: "",
  raw: "hi",
  nick: "neo",
  id: "q-" + room,
  created: 1,
  ...extra,
});

test("a saved session keeps valid channels, queue and mute list", () => {
  const saved = restoreSession({
    identity: { ...identity, color: "#ABCDEF" },
    current: "two",
    rooms: { one: true, two: false, "bad name": true },
    queue: [queued("one"), queued("gone"), { op: "send", room: "one" }],
    ignored: [trip("c"), "short"],
  });
  assert.deepEqual(saved.identity, { ...identity, color: "" });
  assert.deepEqual(saved.rooms, [
    ["one", true],
    ["two", false],
  ]);
  assert.equal(saved.current, "two");
  assert.deepEqual(
    saved.queue.map((q) => q.id),
    ["q-one"],
  );
  assert.deepEqual(saved.ignored, [trip("c")]);
});

test("a login without channels, or with a damaged identity, is signed out", () => {
  const empty = restoreSession({ identity, rooms: {}, ignored: [trip("c")] });
  assert.equal(empty.identity, null);
  assert.equal(empty.current, "");
  assert.deepEqual(empty.ignored, [trip("c")], "the mute list survives");
  const bad = restoreSession({
    identity: { ...identity, proof: "nope" },
    rooms: { one: true },
    queue: [queued("one")],
  });
  assert.equal(bad.identity, null);
  assert.deepEqual(bad.queue, []);
  assert.equal(restoreSession(null).identity, null);
  assert.equal(
    restoreSession({ identity, rooms: { a: 1 } }).rooms[0][1],
    false,
  );
});

test("the current channel falls back to the first and the tab limit applies", () => {
  const rooms = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => ["r" + i, false]),
  );
  const saved = restoreSession({ identity, rooms, current: "r11" });
  assert.equal(saved.rooms.length, 9);
  assert.equal(saved.current, "r0");
});

test("remembered channels are validated and capped", () => {
  assert.deepEqual(restoreKnown(["a", 1, "b c", "d"]), ["a", "d"]);
  assert.equal(restoreKnown(Array(80).fill("x")).length, 50);
  assert.deepEqual(restoreKnown("lobby"), []);
});
