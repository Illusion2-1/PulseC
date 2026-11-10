import { ChatClient, type ChatDeps } from "../src/lib/chat/client.svelte";
import type { Store } from "../src/lib/platform/storage";
import type { TransportHandlers } from "../src/lib/platform/transport";
import type { ClientCommand, ServerEvent } from "../src/lib/types";

/** An in-memory Store. Set `full` to make writes fail like a full quota. */
export function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const store = {
    data,
    full: false,
    get: (key: string) => data.get(key) ?? null,
    set(key: string, value: string) {
      if (store.full) {
        const error = new Error("full");
        error.name = "QuotaExceededError";
        throw error;
      }
      data.set(key, value);
    },
    remove: (key: string) => void data.delete(key),
    keys: () => [...data.keys()],
  } satisfies Store & Record<string, unknown>;
  return store;
}

/** A client wired to a fake relay. `relay.sent` records every command. */
export function makeClient(overrides: Partial<ChatDeps> = {}) {
  const sent: ClientCommand[] = [];
  let handlers: TransportHandlers | undefined;
  const session = memoryStore(),
    local = memoryStore();
  const deps: ChatDeps = {
    connect(h) {
      handlers = h;
      return { send: (c) => sent.push(c), close() {} };
    },
    session,
    local,
    confirm: () => true,
    reload() {},
    restart() {},
    ...overrides,
  };
  const client = new ChatClient(deps);
  const relay = {
    sent,
    /** Commands with this op, in order. */
    ops: <Op extends ClientCommand["op"]>(op: Op) =>
      sent.filter((c): c is Extract<ClientCommand, { op: Op }> => c.op === op),
    connect(boot = "boot-1") {
      handlers!.status("connected");
      handlers!.opened(boot);
    },
    drop() {
      handlers!.status("reconnecting");
    },
    emit(event: ServerEvent) {
      handlers!.received(event);
    },
  };
  return { client, relay, session, local, deps };
}

export const trip = (c: string) => c.repeat(16).slice(0, 16);

export const member = (id: number, nick: string, t = trip(nick[0])) => ({
  id,
  nick,
  trip: t,
  active: Date.now() / 1000,
});

/** A state snapshot for `room` with the given members. */
export const snapshot = (
  room: string,
  users = [member(1, "me", trip("a"))],
  extra: Partial<Extract<ServerEvent, { op: "state" }>> = {},
): ServerEvent => ({
  op: "state",
  room,
  users,
  topic: "",
  pulse: Array(30).fill(0),
  public: false,
  owner: "",
  mods: [],
  banned: [],
  muted: [],
  locked: false,
  topicLocked: false,
  slow: 0,
  ...extra,
});

/** Starts a client, signs in as `me#aaaa…` and joins `room`. */
export function signedIn(room = "lobby", overrides: Partial<ChatDeps> = {}) {
  const ctx = makeClient(overrides);
  const stop = ctx.client.start();
  ctx.relay.connect();
  ctx.client.enter("me", "f".repeat(64), room, false);
  ctx.relay.emit({ op: "identity", trip: trip("a") });
  ctx.relay.emit(snapshot(room));
  return { ...ctx, stop };
}
