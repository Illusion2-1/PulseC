import assert from "node:assert/strict";
import { test } from "vitest";
import { ComposerState } from "../src/lib/chat/composer.svelte";
import { commandNames } from "../src/lib/chat/commands";
import { messages } from "../src/lib/i18n/messages";
import { member, trip } from "./helpers";

function composer(draft = "", cursor = draft.length) {
  const c = new ComposerState({
    users: () => [member(1, "me"), member(2, "Neo"), member(3, "Nell")],
    self: () => "me#" + trip("m"),
    rooms: () => ["lobby", "dev", "lobby"],
    banned: () => [trip("b")],
    ignored: () => [trip("c")],
  });
  c.draft = draft;
  c.cursor = c.selectionEnd = cursor;
  return c;
}

test("command highlighting distinguishes valid, incomplete, unknown and escaped input", () => {
  for (const [draft, state] of [
    ["/col", "partial"],
    ["/color #ff8800", "valid"],
    ["/missing", "invalid"],
    ["/col argument", "invalid"],
    ["//color", ""],
    ["ordinary message", ""],
  ])
    assert.equal(composer(draft).commandState, state, draft);
  for (const name of commandNames)
    assert.ok(Object.hasOwn(messages, "cmd_" + name.slice(1)), name);
});

test("Tab accepts commands and all candidates remain reachable by arrow keys", () => {
  const c = composer("/col");
  assert.equal(c.ghost, "or");
  assert.equal(c.complete(), true);
  assert.equal(c.draft, "/color ");
  assert.equal(c.dismissed, false, "keep the colour picker available");
  const all = composer("/");
  assert.equal(all.suggestions.length, commandNames.length);
  all.move(-1);
  assert.equal(all.selected, commandNames.at(-1));
  assert.ok(all.suggestions.includes(all.selected!));
  all.complete();
  assert.equal(all.draft, commandNames.at(-1) + " ");
});

test("recipient completion preserves the message and replaces only the edited token", () => {
  const c = composer("/w Ne hello\nworld", 5);
  assert.equal(c.ghost, "", "no ghost in the middle of a draft");
  assert.ok(c.suggestions.every((s) => !s.startsWith("me#")));
  const chosen = c.selected!;
  c.complete();
  assert.equal(c.draft, "/w " + chosen + " hello\nworld");
  assert.equal(c.cursor, ("/w " + chosen + " ").length);
  const command = composer("/wi message", 2);
  command.complete();
  assert.equal(command.draft, "/w message");
});

test("argument suggestions use channels, finite rates and the correct offline lists", () => {
  assert.deepEqual(composer("/join #").suggestions, ["#lobby", "#dev"]);
  assert.deepEqual(composer("/slow ").suggestions, [
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
  ]);
  assert.deepEqual(composer("/unban ").suggestions, [trip("b")]);
  assert.deepEqual(composer("/unignore ").suggestions, [trip("c")]);
  assert.deepEqual(composer("/w Neo message").suggestions, []);
  assert.deepEqual(composer("//w ").suggestions, []);
  assert.deepEqual(composer("/slow 9").suggestions, []);
});

test("mentions and bare nicknames complete at the caret without consuming punctuation", () => {
  const mention = composer("hi @Ne, thanks", 6);
  mention.complete();
  assert.equal(mention.draft, "hi @Neo, thanks");
  const bare = composer("hi Ne later", 5);
  bare.complete();
  assert.equal(bare.draft, "hi @Neo later");
  assert.deepEqual(composer("email@Ne").suggestions, []);
  const selected = composer("/col");
  selected.selectionEnd = 2;
  assert.deepEqual(selected.suggestions, []);
  assert.equal(selected.complete(), false);
  assert.equal(selected.draft, "/col");
});

test("Escape hides suggestions and history recall remains editable", () => {
  const c = composer("/jo");
  c.dismiss();
  assert.equal(c.ghost, "");
  assert.deepEqual(c.suggestions, []);
  c.typed();
  assert.equal(c.ghost, "in");
  c.draft = "";
  c.lastInput = "/w Neo saved message";
  assert.equal(c.recall(), true);
  assert.equal(c.draft, c.lastInput);
  assert.equal(c.cursor, c.lastInput.length);
  assert.equal(c.recall(), false);
});
