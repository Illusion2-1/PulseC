// A fixed ring per channel makes the synchronous write on receipt independent of history size.
const prefix = "pulsec.row.";
const cursors = new Map();
const keyFor = (room) => prefix + room + ".";

function decodeRow(key) {
  try {
    const row = JSON.parse(sessionStorage.getItem(key));
    if (
      Number.isSafeInteger(row?.seq) &&
      Number.isFinite(row.message?.time) &&
      typeof row.message.text === "string"
    )
      return row;
  } catch {}
  return null;
}

export function readRows(room) {
  const prefix = keyFor(room);
  const rows = Object.keys(sessionStorage)
    .filter((k) => k.startsWith(prefix))
    .map(decodeRow)
    .filter(Boolean);
  rows.sort((a, b) => a.seq - b.seq);
  cursors.set(room, (rows.at(-1)?.seq ?? -1) + 1);
  return rows.map((r) => r.message);
}

export function appendRow(room, message, replaceLast = false) {
  const seq = Math.max(0, (cursors.get(room) ?? 0) - Number(replaceLast)),
    key = keyFor(room) + (seq % 500);
  const value = JSON.stringify({ seq, message });
  try {
    sessionStorage.setItem(key, value);
  } catch (error) {
    if (error.name !== "QuotaExceededError") throw error;
    const oldest = Object.keys(sessionStorage)
      .filter((k) => k.startsWith(prefix))
      .map((key) => ({
        key,
        time: decodeRow(key)?.message.time ?? 0,
      }))
      .sort((a, b) => a.time - b.time);
    for (const { key } of oldest.slice(
      0,
      Math.max(1, Math.ceil(oldest.length / 10)),
    ))
      sessionStorage.removeItem(key);
    sessionStorage.setItem(key, value);
  }
  cursors.set(room, seq + 1);
}

export function clearRows(room) {
  for (const k of Object.keys(sessionStorage))
    if (k.startsWith(keyFor(room))) sessionStorage.removeItem(k);
  cursors.delete(room);
}
