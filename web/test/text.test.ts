import { test } from "vitest";
import assert from "node:assert/strict";
import {
  averageRate,
  completions,
  mentions,
  pulseHeights,
} from "../src/lib/core/text";

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

test("activity bars scale to the busiest bucket and keep quiet minutes visible", () => {
  assert.deepEqual(pulseHeights([0, 1, 2]), [1, 4.5, 8]);
  assert.deepEqual(pulseHeights([0, 0]), [1, 1]);
  assert.deepEqual(pulseHeights([]), []);
  assert.equal(averageRate([1, 2, 2]), 1.7);
  assert.equal(averageRate([]), 0);
});
