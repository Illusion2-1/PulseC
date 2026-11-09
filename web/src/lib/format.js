export const color = (t) => "t" + (parseInt(t.slice(0, 2), 16) % 8);
export function clash(n, t, users) {
  return users.some((u) => u.nick === n && u.trip !== t);
}
export const spark = (a) =>
  a.map((x) => "▁▂▃▄▅▆▇█"[Math.round((x / Math.max(1, ...a)) * 7)]).join("");
