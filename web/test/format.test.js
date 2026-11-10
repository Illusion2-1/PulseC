import test from "node:test";
import assert from "node:assert/strict";
import {
  completions,
  mentions,
  quoteLanes,
  sameDay,
  threads,
} from "../src/lib/format.js";

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

const msg = (nick, time, text = "x", kind = "chat", ref) => ({
  nick,
  trip: nick.padEnd(16, "0").slice(0, 16),
  time,
  text,
  kind,
  ref,
});

test("consecutive lines form trees until interrupted or ten minutes pass", () => {
  const t0 = new Date(2026, 10, 10, 12).getTime();
  const a1 = msg("a", t0),
    a2 = msg("a", t0 + 1000, "y", "me"),
    a3 = msg("a", t0 + 2000),
    b = msg("b", t0 + 3000),
    a4 = msg("a", t0 + 4000),
    sys = { kind: "sys", text: "notice", time: t0 + 5000 },
    a5 = msg("a", t0 + 6000),
    a6 = msg("a", t0 + 6000 + 600000),
    a7 = msg("a", t0 + 6000 + 600001);
  const items = [a1, a2, a3, b, a4, sys, a5, a6, a7];
  const shape = threads(items);
  assert.deepEqual(
    shape.map((s) => [items.indexOf(s.root), s.leaf, s.last, s.size]),
    [
      [0, false, false, 3],
      [0, true, false, 1],
      [0, true, true, 1],
      [3, false, true, 1],
      [4, false, true, 1],
      [5, false, true, 1],
      [6, false, true, 1],
      [7, false, false, 2], // ten minutes after a5: a new tree
      [7, true, true, 1],
    ],
  );
  assert.equal(threads(items, new Set([a2]))[1].leaf, false, "divider breaks");
});

test("quote lanes connect quoted and quoting rows", () => {
  const items = [
    msg("a", 1, "first", "chat", "aaaaaaaaaaaa"),
    msg("b", 2, "second", "chat", "bbbbbbbbbbbb"),
    msg("c", 3, ">>aaaaaaaaaaaa yes"),
    msg("d", 4, ">>bbbbbbbbbbbb and >>aaaaaaaaaaaa"),
    msg("e", 5, "`>>bbbbbbbbbbbb` in code, >>ffffffffffff missing"),
  ];
  const { rows, gaps, lanes } = quoteLanes(items);
  assert.equal(lanes, 2);
  assert.deepEqual(rows, [
    [[0, "start"]],
    [
      [0, "pass"],
      [1, "start"],
    ],
    [
      [0, "tee"],
      [1, "pass", "cut"],
    ],
    [
      [0, "end"],
      [1, "end"],
    ],
    [],
  ]);
  assert.deepEqual(gaps[3], [0, 1]);
  assert.equal(quoteLanes(items, 1).lanes, 1, "extra links are dropped");
});
