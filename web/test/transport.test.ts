import { test } from "vitest";
import assert from "node:assert/strict";
import { readEvents } from "../src/lib/platform/transport";

async function collect(chunks: Uint8Array[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const events = [];
  for await (const event of readEvents(stream)) events.push(event);
  return events;
}

test("event framing respects UTF-8 fragments, delimiters and the per-event budget", async () => {
  const enc = new TextEncoder();
  const event = { op: "nick", nick: "甲" };
  const line = JSON.stringify(event) + "\n";
  const wire = enc.encode(line + line);
  const split = wire.indexOf(0xe7) + 1;
  assert.deepEqual(await collect([wire.slice(0, split), wire.slice(split)]), [
    event,
    event,
  ]);
  const full = enc.encode(JSON.stringify({ op: "ping" }).padEnd(1 << 20));
  assert.equal((await collect([full, enc.encode("\n" + line)])).length, 2);
  await assert.rejects(collect([full, enc.encode(" ")]), /too large/);
  await assert.rejects(collect([enc.encode(line.trimEnd())]), /Incomplete/);
  await assert.rejects(collect([Uint8Array.of(255, 10)]), TypeError);
});
