import { afterEach, test } from "vitest";
import assert from "node:assert/strict";
import { ChatClient } from "../src/lib/chat/client.svelte";
import { parseCommand } from "../src/lib/chat/commands";
import { describeModeration, resolveTarget } from "../src/lib/chat/moderation";
import { Outbox, deliveryUnknown } from "../src/lib/chat/outbox.svelte";
import { limits } from "../src/lib/config";
import type { Outgoing, RoomState } from "../src/lib/types";
import { makeClient, member, signedIn, snapshot, trip } from "./helpers";

const stops: (() => void)[] = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));
function chat(...args: Parameters<typeof signedIn>) {
  const ctx = signedIn(...args);
  stops.push(ctx.stop);
  return ctx;
}
const say = (client: ChatClient, text: string) => {
  client.composer.draft = text;
  client.submit();
};
const last = (client: ChatClient) => client.room!.log.at(-1)!;

test("connection details follow the live relay and clear on disconnect", () => {
  const { client, relay } = chat();
  assert.equal(client.connection, null, "older relays have no details");
  relay.emit({
    op: "connection",
    transport: "WebTransport",
    encryption: "TLS 1.3",
  });
  assert.deepEqual(client.connection, {
    transport: "WebTransport",
    encryption: "TLS 1.3",
  });
  relay.drop();
  assert.equal(client.connection, null);
  relay.connect();
  assert.equal(client.connection, null);
  relay.emit({
    op: "connection",
    transport: "WebSocket",
    encryption: "TLS 1.2",
  });
  assert.deepEqual(client.connection, {
    transport: "WebSocket",
    encryption: "TLS 1.2",
  });
});

test("row totals keep increasing past retained history and survive refresh", () => {
  const { client, session, local } = chat();
  client.clearLog();
  for (let i = 0; i < limits.history + 2; i++)
    client.add("lobby", {
      kind: "chat",
      text: String(i),
      time: i,
      ref: String(i),
    });
  assert.equal(client.room!.total, limits.history + 2);
  assert.equal(client.items.length, limits.history);
  assert.equal(client.items[0].text, "2");
  client.add("lobby", last(client));
  assert.equal(
    client.room!.total,
    limits.history + 2,
    "duplicates do not count twice",
  );
  client.add("lobby", { kind: "presence", text: "one", time: 1000 });
  client.add("lobby", { kind: "presence", text: "two", time: 1001 });
  assert.equal(
    client.room!.total,
    limits.history + 3,
    "merged rows count once",
  );
  const next = makeClient({ session, local }).client;
  next.restore();
  assert.equal(next.room!.total, limits.history + 3);
  next.clearLog();
  assert.equal(next.room!.total, 0);
  assert.equal(next.items.length, 0);
  session.full = true;
  next.add("lobby", { kind: "chat", text: "storage unavailable", time: 1002 });
  assert.equal(
    next.room!.total,
    1,
    "storage failure does not stop the live counter",
  );
});

test("retry within the same relay's two-minute window", () => {
  const msg = { boot: "a", attempt: 1000 };
  assert.equal(deliveryUnknown(msg, "a", 121000), false);
  assert.equal(deliveryUnknown(msg, "a", 121001), true);
  assert.equal(deliveryUnknown(msg, "b", 1100), true);
  assert.equal(deliveryUnknown({}, "b", 123000), false);
});

test("the outbox keeps the send in flight and drops the rest of a parted room", () => {
  const box = new Outbox();
  const q = (id: string, room: string) =>
    ({
      id,
      room,
      op: "send",
      kind: "chat",
      text: "",
      to: "",
      raw: id,
      nick: "",
      created: 0,
    }) as Outgoing;
  box.queue = [q("1", "a"), q("2", "a"), q("3", "b")];
  box.inflight = "1";
  assert.deepEqual(
    box.drop("a").map((m) => m.id),
    ["2"],
  );
  assert.deepEqual(
    box.queue.map((m) => m.id),
    ["1", "3"],
  );
  assert.equal(box.left(0), 6);
  for (let i = 0; i < 6; i++) box.acked("x", 1000 + i);
  assert.equal(box.left(1010), 0);
  assert.equal(box.left(11006), 6, "the window slides");
});

test("a draft is queued, transmitted once joined and logged on ack", () => {
  const { client, relay } = chat();
  assert.deepEqual(relay.ops("join"), [
    { op: "join", room: "lobby", public: false },
  ]);
  assert.equal(last(client).code, "joinedRoom");
  say(client, "hello");
  assert.equal(client.composer.draft, "");
  const [sent] = relay.ops("send");
  assert.equal(sent.text, "hello");
  assert.equal(client.outbox.inflight, sent.id);
  relay.emit({ op: "ack", id: sent.id, ref: "0123456789ab" });
  assert.equal(client.outbox.queue.length, 0);
  assert.equal(last(client).text, "hello");
  assert.equal(last(client).trip, trip("a"));
  assert.equal(client.composer.lastInput, "hello");
});

test("an unconfirmed send is retried on the same relay and abandoned after a restart", () => {
  const { client, relay } = chat();
  say(client, "once");
  relay.drop();
  assert.equal(client.room!.joined, false);
  relay.connect("boot-1");
  relay.emit(snapshot("lobby"));
  assert.equal(last(client).code, "rejoined");
  assert.equal(relay.ops("send").length, 2, "same relay: retried");
  assert.equal(relay.ops("send")[0].id, relay.ops("send")[1].id);

  relay.drop();
  relay.connect("boot-2");
  relay.emit(snapshot("lobby"));
  assert.equal(relay.ops("send").length, 2, "new relay: not retried");
  assert.equal(client.outbox.queue.length, 0);
  assert.equal(last(client).code, "uncertain");
});

test("commands keep a draft that needs correcting", () => {
  const { client, relay } = chat();
  say(client, "/nope x");
  assert.equal(client.composer.draft, "/nope x");
  assert.equal(last(client).code, "unknownCommand");
  say(client, "/w neo");
  assert.equal(client.composer.draft, "/w neo");
  assert.equal(last(client).code, "whisperUsage");
  say(client, "/w neo#" + trip("b") + " psst");
  const [w] = relay.ops("send");
  assert.deepEqual(
    [w.kind, w.to, w.text],
    ["whisper", "neo#" + trip("b"), "psst"],
  );
  say(client, "//root");
  assert.equal(relay.ops("send").length, 1, "the whisper is still in flight");
  assert.equal(client.outbox.queue[1].text, "/root");
  say(client, "/me");
  assert.equal(last(client).code, "needText");
  assert.equal(client.composer.draft, "");
});

test("a queued whisper stays bound to the identity selected before reconnect", () => {
  const { client, relay } = chat();
  const target = member(2, "neo", trip("b"));
  relay.emit(snapshot("lobby", [target]));
  say(client, "/w neo private");
  relay.drop();
  relay.connect();
  relay.emit(snapshot("lobby", [member(3, "neo", trip("c"))]));
  assert.deepEqual(
    relay.ops("send").map((m) => m.to),
    Array(2).fill("neo#" + target.trip),
  );
});

test("a legacy nickname-only whisper stays recoverable without being transmitted", () => {
  const { client, relay } = chat();
  say(client, "/w neo#" + trip("b") + " private");
  relay.drop();
  client.outbox.queue[0].to = "neo";
  delete client.outbox.queue[0].attempt;
  relay.connect();
  relay.emit(snapshot("lobby", [member(3, "neo", trip("c"))]));
  assert.equal(relay.ops("send").length, 1);
  assert.equal(last(client).code, "recipient_required");
  assert.ok(last(client).unsent);
});

test("command parsing leaves // and plain text alone", () => {
  assert.deepEqual(parseCommand("/join  #x"), { name: "/join", arg: "#x" });
  assert.deepEqual(parseCommand("/me\nwaves"), { name: "/me", arg: "waves" });
  assert.equal(parseCommand("//not"), null);
  assert.equal(parseCommand("hi /there"), null);
});

test("moderation targets resolve to one trip", () => {
  const state: RoomState = {
    users: [
      member(1, "neo", trip("a")),
      member(2, "neo", trip("b")),
      member(3, "amy", trip("c")),
    ],
    topic: "",
    pulse: [],
    banned: [trip("d")],
  };
  assert.deepEqual(resolveTarget(state, "amy"), { trip: trip("c") });
  assert.deepEqual(resolveTarget(state, "neo"), { error: "ambiguousTarget" });
  assert.deepEqual(resolveTarget(state, "neo#" + trip("b")), {
    trip: trip("b"),
  });
  assert.deepEqual(resolveTarget(state, trip("e")), { trip: trip("e") });
  assert.deepEqual(resolveTarget(state, "dddd", true), { trip: trip("d") });
  assert.deepEqual(resolveTarget(state, "dddd"), { error: "needTarget" });
  assert.deepEqual(resolveTarget(state, " "), { error: "needTarget" });
});

test("moderation events name the actor and notice removal of this tab", () => {
  const e = {
    op: "moderation" as const,
    room: "r",
    action: "kick" as const,
    by: { nick: "op", trip: trip("o") },
    target: trip("a"),
    nick: "me",
    on: false,
    rate: 0,
  };
  assert.deepEqual(describeModeration(e, trip("a")), {
    code: "modKick",
    params: { by: "op#ooooo", target: "me#aaaaa", rate: 0 },
    removed: "youKicked",
  });
  assert.equal(
    describeModeration({ ...e, action: "lock", on: true }, "").code,
    "modLock",
  );
  assert.equal(
    describeModeration({ ...e, action: "slow", on: false }, "").code,
    "modSlowOff",
  );
});

test("a kicked tab stays open for reading and refuses new sends", () => {
  const { client, relay } = chat("room");
  relay.emit({
    op: "moderation",
    room: "room",
    action: "kick",
    by: { nick: "op", trip: trip("o") },
    target: trip("a"),
    nick: "me",
    on: false,
    rate: 0,
  });
  assert.equal(client.room!.parted, true);
  assert.equal(last(client).code, "youKicked");
  say(client, "still here?");
  assert.equal(client.composer.draft, "still here?");
  assert.equal(last(client).code, "parted");
  assert.equal(relay.ops("send").length, 0);
});

test("admin commands check rights locally and ask before a ban", () => {
  let asked = "";
  const { client, relay } = chat("room", {
    confirm: (message) => ((asked = message), false),
  });
  say(client, "/kick amy");
  assert.equal(last(client).code, "needTarget");
  relay.emit(
    snapshot("room", [member(1, "me", trip("a")), member(2, "amy", trip("c"))]),
  );
  say(client, "/kick amy");
  assert.equal(last(client).code, "not_admin");
  relay.emit(
    snapshot(
      "room",
      [member(1, "me", trip("a")), member(2, "amy", trip("c"))],
      {
        owner: trip("a"),
      },
    ),
  );
  say(client, "/ban amy");
  assert.match(asked, /amy/);
  assert.equal(relay.ops("moderate").length, 0, "declined");
  say(client, "/kick amy");
  assert.deepEqual(relay.ops("moderate"), [
    { op: "moderate", room: "room", action: "kick", target: trip("c") },
  ]);
});

test("background channels count unread rows and mentions", () => {
  const { client, relay } = chat("one");
  client.join("two");
  relay.emit(snapshot("two"));
  assert.equal(client.current, "two");
  const message = (text: string, room = "one") =>
    relay.emit({
      op: "message",
      room,
      ref: "",
      nick: "neo",
      trip: trip("b"),
      kind: "chat",
      text,
      time: Date.now(),
    });
  message("hi");
  message("@me look");
  const one = client.rooms.get("one")!;
  assert.equal(one.unread, 2);
  assert.equal(one.mentioned, true);
  assert.equal(client.pending, 2);
  assert.equal(client.pinged, true);
  client.select("one");
  assert.equal(one.unread, 0);
  assert.equal(client.unreadCount, 2);
  assert.equal(client.firstUnread?.text, "hi");
  assert.equal(client.pending, 0);
});

test("ignored trips are dropped and duplicate refs are not logged twice", () => {
  const { client, relay } = chat();
  const base = {
    op: "message" as const,
    room: "lobby",
    nick: "x",
    kind: "chat" as const,
    time: Date.now(),
  };
  relay.emit({ ...base, ref: "aaaaaaaaaaaa", trip: trip("b"), text: "one" });
  relay.emit({ ...base, ref: "aaaaaaaaaaaa", trip: trip("b"), text: "one" });
  say(client, "/ignore x#" + trip("b"));
  relay.emit({ ...base, ref: "bbbbbbbbbbbb", trip: trip("b"), text: "two" });
  assert.equal(client.room!.log.filter((m) => m.text === "one").length, 1);
  assert.equal(
    client.room!.log.some((m) => m.text === "two"),
    false,
  );
  assert.equal(
    client.items.some((m) => m.text === "one"),
    false,
    "hidden from view",
  );
});

test("presence rows within ten seconds merge into one", () => {
  const { client, relay } = chat();
  const join = (id: number, nick: string) =>
    relay.emit({
      op: "member",
      room: "lobby",
      action: "join",
      user: member(id, nick),
      text: "+ " + nick,
    });
  join(2, "amy");
  join(3, "bob");
  const row = last(client);
  assert.equal(row.kind, "presence");
  assert.equal(row.parts?.length, 2);
  assert.equal(client.state.users.length, 3);
});

test("a rejected send restores the draft and keeps the input in the notice", () => {
  const { client, relay } = chat();
  say(client, "too much");
  const [sent] = relay.ops("send");
  relay.emit({ op: "error", id: sent.id, code: "room_muted", request: "send" });
  assert.equal(client.composer.draft, "too much");
  assert.equal(last(client).unsent, "too much");
  assert.equal(last(client).warn, true);
  assert.equal(client.outbox.queue.length, 0);
});

test("a rate-limited send waits and the local burst limit keeps the draft", () => {
  const { client, relay } = chat();
  say(client, "slow");
  const [sent] = relay.ops("send");
  relay.emit({ op: "limited", id: sent.id, wait: 2000 });
  assert.equal(client.outbox.inflight, "");
  assert.equal(client.outbox.queue[0].attempt, undefined);
  assert.ok(client.outbox.until > Date.now());
  client.outbox.until = 0;
  client.flush();
  relay.emit({ op: "ack", id: sent.id, ref: "" });
  for (let i = 0; i < 5; i++) {
    say(client, "m" + i);
    const m = relay.ops("send").at(-1)!;
    relay.emit({ op: "ack", id: m.id, ref: "" });
  }
  assert.equal(client.left, 0);
  say(client, "seventh");
  assert.equal(last(client).code, "retained");
  assert.equal(client.composer.draft, "seventh");
});

test("a locked room parts the tab and suggests a retry", () => {
  const { client, relay } = chat();
  client.join("closed");
  relay.emit({
    op: "error",
    code: "room_locked",
    request: "join",
    room: "closed",
  });
  const room = client.rooms.get("closed")!;
  assert.equal(room.parted, true);
  assert.deepEqual(
    room.log.slice(-2).map((m) => m.code),
    ["room_locked", "retryJoin"],
  );
});

test("leaving waits for pending sends; leaving the last tab signs out", () => {
  let reloaded = false;
  const { client, relay, session } = chat("lobby", {
    reload: () => (reloaded = true),
  });
  say(client, "wait");
  client.leave();
  assert.equal(last(client).code, "leavePending");
  relay.emit({ op: "ack", id: relay.ops("send")[0].id, ref: "" });
  client.leave();
  assert.deepEqual(relay.ops("leave"), [{ op: "leave", room: "lobby" }]);
  assert.equal(client.current, "");
  assert.equal(client.identity, null);
  assert.equal(reloaded, true);
  assert.equal(JSON.parse(session.get("pulsec.session")!).identity, null);
});

test("a refresh restores identity, tabs, history and the queue", () => {
  const { client, relay, session, local } = chat("lobby");
  client.join("two");
  relay.emit(snapshot("two"));
  relay.drop();
  say(client, "after refresh");
  const next = makeClient({ session, local });
  next.client.restore();
  assert.equal(next.client.identity?.nick, "me");
  assert.deepEqual([...next.client.rooms.keys()], ["lobby", "two"]);
  assert.equal(next.client.current, "two");
  assert.equal(next.client.rooms.get("lobby")!.log[0].code, "joinedRoom");
  assert.equal(next.client.outbox.queue[0].raw, "after refresh");
  assert.deepEqual(next.client.known, ["two", "lobby"]);
});

test("confirmed nickname changes update only an opted-in saved login", () => {
  const { client, relay, local } = chat();
  const login = { nick: "me", password: " exact trip 密码 " };
  local.set("pulsec.login", JSON.stringify(login));
  say(client, "/nick 新昵称");
  assert.deepEqual(relay.ops("nick").at(-1), { op: "nick", nick: "新昵称" });
  assert.deepEqual(JSON.parse(local.get("pulsec.login")!), login);
  relay.emit({ op: "nick", nick: "新昵称" });
  assert.equal(client.identity?.nick, "新昵称");
  assert.deepEqual(JSON.parse(local.get("pulsec.login")!), {
    ...login,
    nick: "新昵称",
  });
  relay.emit({ op: "nick", nick: "bad name" });
  assert.equal(client.identity?.nick, "新昵称");
  assert.equal(JSON.parse(local.get("pulsec.login")!).nick, "新昵称");

  local.remove("pulsec.login");
  relay.emit({ op: "nick", nick: "NotRemembered" });
  assert.equal(client.identity?.nick, "NotRemembered");
  assert.equal(local.get("pulsec.login"), null, "opt-out remains in effect");
});

test("damaged or unwritable saved login does not prevent a live nickname change", () => {
  const { client, relay, session, local } = chat();
  local.set("pulsec.login", "malformed");
  relay.emit({ op: "nick", nick: "Changed" });
  assert.equal(client.identity?.nick, "Changed");
  assert.equal(local.get("pulsec.login"), "malformed");

  const login = { nick: "Old", password: "secret" };
  local.set("pulsec.login", JSON.stringify(login));
  local.full = true;
  relay.emit({ op: "nick", nick: "ChangedAgain" });
  assert.equal(client.identity?.nick, "ChangedAgain");
  assert.equal(
    JSON.parse(session.get("pulsec.session")!).identity.nick,
    "ChangedAgain",
  );
  assert.deepEqual(JSON.parse(local.get("pulsec.login")!), login);
  assert.equal(client.cacheError, "rememberFailed");
});

test("confirmed colours persist across sign-ins and reset overrides an older session", () => {
  const { client, relay, session, local } = chat();
  say(client, "/color #F80");
  assert.deepEqual(relay.ops("color").at(-1), {
    op: "color",
    color: "#ff8800",
  });
  assert.equal(local.get("pulsec.color"), null, "wait for confirmation");
  relay.emit({ op: "color", color: "#ff8800" });
  assert.equal(JSON.parse(local.get("pulsec.color")!), "#ff8800");

  const next = makeClient({ local });
  next.client.restore();
  assert.equal(next.client.preferredColor, "#ff8800");
  const stop = next.client.start();
  stops.push(stop);
  next.relay.connect();
  next.client.enter("other", "b".repeat(64), "lobby", false);
  assert.equal(next.client.identity?.color, "#ff8800");
  assert.equal(next.relay.ops("identity").at(-1)?.color, "#ff8800");
  next.relay.drop();
  next.relay.connect();
  assert.equal(next.relay.ops("identity").at(-1)?.color, "#ff8800");

  say(next.client, "/color");
  assert.equal(next.relay.ops("color").at(-1)?.color, "");
  next.relay.emit({ op: "color", color: "" });
  assert.equal(JSON.parse(local.get("pulsec.color")!), "");
  const refreshed = makeClient({ session, local }).client;
  refreshed.restore();
  assert.equal(refreshed.preferredColor, "");
  assert.equal(refreshed.identity?.color, "", "old session colour stays reset");
});

test("legacy session colour migrates; invalid events and failed storage preserve live colour", () => {
  const { client, relay, session, local } = chat();
  relay.emit({ op: "color", color: "#00ff00" });
  local.remove("pulsec.color");
  const restored = makeClient({ session, local }).client;
  restored.restore();
  assert.equal(restored.preferredColor, "#00ff00");
  assert.equal(JSON.parse(local.get("pulsec.color")!), "#00ff00");

  relay.emit({ op: "color", color: "invalid" });
  assert.equal(client.preferredColor, "#00ff00");
  assert.equal(JSON.parse(local.get("pulsec.color")!), "#00ff00");
  local.full = true;
  relay.emit({ op: "color", color: "#ff8800" });
  assert.equal(client.preferredColor, "#ff8800");
  assert.equal(client.identity?.color, "#ff8800");
  assert.equal(client.cacheError, "colorSaveFailed");
  local.full = false;
  local.set("pulsec.color", JSON.stringify("not-a-colour"));
  const fresh = makeClient({ local }).client;
  fresh.restore();
  assert.equal(fresh.preferredColor, "");
});

test("/forget clears chat data after confirmation", () => {
  let restarted = false;
  const { client, session, local } = chat("lobby", {
    restart: () => (restarted = true),
  });
  say(client, "/forget");
  assert.equal(restarted, true);
  assert.equal(session.get("pulsec.session"), null);
  assert.equal(local.get("pulsec.channels"), null);
});
