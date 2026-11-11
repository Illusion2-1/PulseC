import type { ClientCommand, ServerEvent, Status } from "../types";

export interface TransportHandlers {
  status(status: Status): void;
  /** The stream is open; `boot` identifies this relay process. */
  opened(boot: string): void;
  received(event: ServerEvent): void;
  /** Called every 10 s while connected. */
  heartbeat(): void;
}

export interface Transport {
  send(command: ClientCommand): void;
  close(): void;
}

export type Connect = (handlers: TransportHandlers) => Transport;

interface Attempt {
  send?: (command: ClientCommand) => void;
  close?: () => void;
}

// A snapshot can contain all 4096 members. Limit each newline-delimited
// event in wire bytes, including fragments still waiting for a newline.
const maxEventBytes = 1 << 20;

export async function* readEvents(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        if (size) throw Error("Incomplete event");
        return;
      }
      for (let start = 0; start < value.length;) {
        const newline = value.indexOf(10, start);
        const end = newline < 0 ? value.length : newline;
        size += end - start;
        if (size > maxEventBytes) throw Error("Event too large");
        text += decoder.decode(value.subarray(start, end), {
          stream: newline < 0,
        });
        if (newline >= 0) {
          const event = JSON.parse(text);
          if (typeof event?.op !== "string") throw Error("Invalid event");
          yield event as ServerEvent;
          text = "";
          size = 0;
        }
        start = end + 1;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Each attempt owns its stream and timers. A retired session cannot write into its successor.
// Failed attempts back off exponentially from 0.5 s to 15 s with ±20 % jitter.
export const connect: Connect = ({ status, opened, received, heartbeat }) => {
  let active: Attempt | null = null,
    timer: ReturnType<typeof setTimeout> | undefined,
    stopped = false,
    delay = 500;
  const encoder = new TextEncoder();
  async function attempt() {
    if (stopped) return;
    if (!window.WebTransport) {
      status("unsupported");
      return;
    }
    let transport: WebTransport | undefined,
      timeout: ReturnType<typeof setTimeout> | undefined,
      pulse: ReturnType<typeof setInterval> | undefined,
      writer: WritableStreamDefaultWriter<Uint8Array>;
    const token: Attempt = {};
    active = token;
    status("connecting");
    function fail() {
      try {
        transport?.close();
      } catch {}
    }
    try {
      const response = await fetch("/config", {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw Error();
      const { pin, boot } = (await response.json()) as {
        pin?: string;
        boot: string;
      };
      if (stopped) return;
      const options: WebTransportOptions = pin
        ? {
            serverCertificateHashes: [
              {
                algorithm: "sha-256" as const,
                value: Uint8Array.from(atob(pin), (c) => c.charCodeAt(0)),
              },
            ],
          }
        : {};
      transport = new WebTransport(
        "https://" + location.host + "/connect",
        options,
      );
      token.close = fail;
      transport.closed.catch(() => {});
      timeout = setTimeout(fail, 12000);
      await transport.ready;
      const stream = await transport.createBidirectionalStream();
      writer = stream.writable.getWriter();
      clearTimeout(timeout);
      let last = Date.now();
      token.send = (cmd) =>
        writer.write(encoder.encode(JSON.stringify(cmd) + "\n")).catch(fail);
      opened(boot);
      status("connected");
      pulse = setInterval(() => {
        if (Date.now() - last > 45000) fail();
        else heartbeat();
      }, 10000);
      for await (const event of readEvents(stream.readable)) {
        if (stopped) break;
        last = Date.now();
        delay = 500;
        received(event);
      }
    } catch {
    } finally {
      clearTimeout(timeout);
      clearInterval(pulse);
      active = null;
      fail();
      if (!stopped) {
        status("reconnecting");
        timer = setTimeout(attempt, delay * (0.8 + Math.random() * 0.4));
        delay = Math.min(delay * 2, 15000);
      }
    }
  }
  attempt();
  return {
    send(cmd: ClientCommand) {
      active?.send?.(cmd);
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      active?.close?.();
    },
  };
};
