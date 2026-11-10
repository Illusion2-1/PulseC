import test from "node:test";
import assert from "node:assert/strict";
import {
  colorOf,
  defaultColor,
  normalizeHex,
  readable,
} from "../src/lib/colors.js";

const lightness = (css) => Number(/oklch\(([\d.]+)/.exec(css)[1]);

test("the default colour depends only on nick and trip", () => {
  const trip = "0123456789abcdef";
  assert.equal(defaultColor("neo", trip), defaultColor("neo", trip));
  assert.notEqual(defaultColor("neo", trip), defaultColor("neo2", trip));
  assert.equal(colorOf({ nick: "neo", trip }), defaultColor("neo", trip));
  assert.equal(colorOf({}), "");
});

test("custom colours are normalised and kept readable", () => {
  assert.equal(normalizeHex("#F80"), "#ff8800");
  assert.equal(normalizeHex("00ff00"), "#00ff00");
  assert.equal(normalizeHex("red"), null);
  assert.equal(normalizeHex("#12345"), null);
  assert.ok(lightness(readable("#000000")) >= 0.68, "black is lifted");
  assert.ok(lightness(readable("#ffffff")) <= 0.9, "white is dimmed");
  assert.equal(
    lightness(readable("#ff8800")),
    0.744,
    "readable colours keep L",
  );
  assert.equal(
    colorOf({ nick: "a", trip: "0123456789abcdef", color: "bogus" }),
    defaultColor("a", "0123456789abcdef"),
    "an unusable colour falls back to the default",
  );
});
