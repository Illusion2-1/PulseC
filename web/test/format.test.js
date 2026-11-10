import test from "node:test";
import assert from "node:assert/strict";
import { completions, mentions, sameDay } from "../src/lib/format.js";

test("mentions require a whole nickname", () => {
  assert.equal(mentions("hi @Detour", "Detour"), true);
  assert.equal(mentions("@Detour, look", "Detour"), true);
  assert.equal(mentions("@DetourX hi", "Detour"), false);
  assert.equal(mentions("@Det hi", "Detour"), false);
  assert.equal(mentions("mail a@Detour", "Detour"), false);
  assert.equal(mentions("@DetourX and @Detour", "Detour"), true);
  assert.equal(mentions("@你好 在吗", "你好"), true);
  assert.equal(mentions("@你好吗", "你好"), false);
  assert.equal(mentions("anything", ""), false);
});

test("completions ignore case, drop duplicate tabs and yourself", () => {
  const users = [
    { id: 1, nick: "Alice", trip: "a" },
    { id: 2, nick: "Alice", trip: "a" },
    { id: 3, nick: "alfred", trip: "b" },
    { id: 4, nick: "Al", trip: "c" },
    { id: 5, nick: "Bob", trip: "d" },
  ];
  assert.deepEqual(completions(users, "al", "Al#c"), ["Alice#a", "alfred#b"]);
  assert.deepEqual(completions(users, "", "Bob#d"), [
    "Al#c",
    "Alice#a",
    "alfred#b",
  ]);
});

test("day boundaries follow local dates", () => {
  const morning = new Date(2026, 10, 10, 8).getTime();
  assert.equal(sameDay(morning, new Date(2026, 10, 10, 23).getTime()), true);
  assert.equal(sameDay(morning, new Date(2026, 10, 11, 0).getTime()), false);
});
