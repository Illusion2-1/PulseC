import { test } from "vitest";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  clash,
  deriveProof,
  handle,
  shortHandle,
  tripOf,
} from "../src/lib/core/identity";
import { parse } from "../src/lib/core/markup";
import {
  applyMember,
  canManage,
  isAdmin,
  roleOf,
} from "../src/lib/core/roster";
import type { RoomState } from "../src/lib/types";
import { member, trip } from "./helpers";

test("roster changes distinguish tabs sharing an identity", () => {
  const a = { id: 1, nick: "same", trip: "t", active: 0 };
  const b = { ...a, id: 2 };
  assert.deepEqual(applyMember([a, b], "nick", { ...b, nick: "new" }), [
    a,
    { ...b, nick: "new" },
  ]);
  assert.deepEqual(applyMember([a, b], "leave", a), [b]);
  assert.deepEqual(applyMember([a], "join", a), [a]);
});

test("only the creator manages moderators; nobody manages the creator", () => {
  const owner = trip("o"),
    mod = trip("m"),
    user = trip("u");
  const state: RoomState = {
    users: [],
    topic: "",
    pulse: [],
    owner,
    mods: [mod],
  };
  assert.equal(isAdmin(state, owner), true);
  assert.equal(isAdmin(state, mod), true);
  assert.equal(isAdmin(state, user), false);
  assert.equal(isAdmin({ ...state, owner: "" }, ""), false);
  assert.equal(canManage(state, owner, mod), true);
  assert.equal(canManage(state, mod, mod), false);
  assert.equal(canManage(state, mod, owner), false);
  assert.equal(canManage(state, mod, user), true);
  assert.equal(canManage(state, user, mod), false);
  assert.deepEqual(
    [owner, mod, user].map((t) => roleOf(state, t)),
    ["@", "+", ""],
  );
});

test("handles and impersonation marks", () => {
  const users = [member(1, "neo", trip("a")), member(2, "neo", trip("b"))];
  assert.equal(handle(users[0]), "neo#" + trip("a"));
  assert.equal(shortHandle(users[0]), "neo#aaaaa");
  assert.equal(clash("neo", trip("a"), users), true);
  assert.equal(clash("neo", trip("a"), users.slice(0, 1)), false);
});

test("a password derives the same trip on every visit to one origin", async () => {
  const g = globalThis as { crypto?: unknown };
  g.crypto ??= webcrypto;
  const proof = await deriveProof("secret", "https://chat.example");
  assert.match(proof, /^[a-f0-9]{64}$/);
  assert.equal(proof, await deriveProof("secret", "https://chat.example"));
  assert.notEqual(proof, await deriveProof("secret", "https://other.example"));
  assert.match(await tripOf(proof), /^[a-f0-9]{16}$/);
});

test("message markup separates code, links, quotes and mentions", () => {
  const [prose, code, rest] = parse(
    "> quoted @neo see https://x.test/a\n```js\nlet a\n\n```tail >>0123456789ab `x`",
  );
  assert.deepEqual(prose, {
    kind: "prose",
    lines: [
      {
        quote: true,
        tokens: [
          { kind: "text", text: "> quoted " },
          { kind: "mention", nick: "neo" },
          { kind: "text", text: " see " },
          { kind: "link", href: "https://x.test/a" },
        ],
      },
      { quote: false, tokens: [] },
    ],
  });
  assert.deepEqual(code, { kind: "code", lang: "js", lines: ["let a", ""] });
  assert.deepEqual(rest, {
    kind: "prose",
    lines: [
      {
        quote: false,
        tokens: [
          { kind: "text", text: "tail " },
          { kind: "ref", ref: "0123456789ab" },
          { kind: "text", text: " " },
          { kind: "code", code: "x" },
        ],
      },
    ],
  });
  assert.equal(parse(">>0123456789ab")[0].kind, "prose");
  const [line] = (parse(">>0123456789ab")[0] as { lines: { quote: boolean }[] })
    .lines;
  assert.equal(line.quote, false, ">>ref is not a quote line");
});
