import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMember,
  deliveryUnknown,
  forgetChatData,
} from "../src/lib/session.js";

test("roster changes distinguish tabs sharing an identity", () => {
  const a = { id: 1, nick: "same", trip: "t" };
  const b = { ...a, id: 2 };
  assert.deepEqual(applyMember([a, b], "nick", { ...b, nick: "new" }), [
    a,
    { ...b, nick: "new" },
  ]);
  assert.deepEqual(applyMember([a, b], "leave", a), [b]);
  assert.deepEqual(applyMember([a], "join", a), [a]);
});

test("retry within the same relay's two-minute window", () => {
  const msg = { boot: "a", attempt: 1000 };
  assert.equal(deliveryUnknown(msg, "a", 121000), false);
  assert.equal(deliveryUnknown(msg, "a", 121001), true);
  assert.equal(deliveryUnknown(msg, "b", 1100), true);
  assert.equal(deliveryUnknown({}, "b", 123000), false);
});

test("forget removes only this application's chat data", () => {
  function store(keys) {
    return Object.assign(
      {
        removeItem(k) {
          delete this[k];
        },
      },
      Object.fromEntries(keys.map((k) => [k, "x"])),
    );
  }
  const tab = store(["pulsec.session", "pulsec.row.lobby.4", "unrelated"]);
  const local = store(["pulsec.channels", "pulsec.language", "unrelated"]);
  forgetChatData(tab, local);
  assert.equal(tab["pulsec.session"], undefined);
  assert.equal(tab["pulsec.row.lobby.4"], undefined);
  assert.equal(local["pulsec.channels"], undefined);
  assert.equal(tab.unrelated, "x");
  assert.equal(local["pulsec.language"], "x");
});
