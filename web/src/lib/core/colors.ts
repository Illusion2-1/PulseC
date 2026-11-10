// Display colours. The default is derived from nick#trip, so every client shows
// the same colour without coordination. A colour chosen with /color is relayed
// as #rrggbb; every client clamps it to a lightness that stays readable on the
// dark background, so no one can make their name invisible or glaring.

const minL = 0.68,
  maxL = 0.9,
  maxC = 0.19;

function hash(text: string) {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const round = (x: number, n = 3) => Math.round(x * 10 ** n) / 10 ** n;
const css = (l: number, c: number, h: number) =>
  `oklch(${round(l)} ${round(c)} ${round(h, 1)})`;

export function defaultColor(nick: string, trip: string) {
  const h = hash(nick + "#" + trip);
  // Alternate two lightness levels so neighbouring hues still differ.
  return css(h & 1 ? 0.74 : 0.84, 0.13, (h >>> 1) % 360);
}

export function normalizeHex(input: string) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
  return "#" + hex.toLowerCase();
}

// sRGB → OKLCH (Björn Ottosson's OKLab), then clamp lightness and chroma.
export function readable(hex: string) {
  const v = normalizeHex(hex);
  if (!v) return null;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return css(Math.min(maxL, Math.max(minL, L)), Math.min(maxC, C), H);
}

export function colorOf(
  user: { nick?: string; trip?: string; color?: string } | null | undefined,
) {
  if (!user?.trip) return "";
  return (
    (user.color && readable(user.color)) ||
    defaultColor(user.nick || "", user.trip)
  );
}
