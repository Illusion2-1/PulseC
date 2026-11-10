import { colorPattern, handle } from "../core/identity";
import { applyMember, touch } from "../core/roster";
import { t } from "../i18n/locale.svelte";
import type { EventOf, NoticePart, ServerEvent } from "../types";
import type { ChatClient } from "./client.svelte";
import { describeModeration } from "./moderation";

type Handlers = {
  [Op in ServerEvent["op"]]: (client: ChatClient, event: EventOf<Op>) => void;
};

// A member change or legacy notice becomes a presence row; bursts merge in add().
function presence(c: ChatClient, e: EventOf<"member"> | EventOf<"notice">) {
  if (!e.text || !c.rooms.has(e.room)) return;
  const code = ({ join: "memberJoin", leave: "memberLeave" } as const)[
    e.action as "join" | "leave"
  ];
  const part: NoticePart =
    code && e.user
      ? { code, params: { name: handle(e.user) }, text: e.text }
      : { text: e.text };
  c.add(e.room, {
    kind: "presence",
    text: e.text,
    parts: [part],
    time: Date.now(),
  });
}

const rejected = (e: { text?: string }) => e.text || t("rejected");

// One handler per relay event (docs/protocol.md). Unknown events are ignored.
const handlers: Handlers = {
  connection(c, e) {
    c.connection = { transport: e.transport, encryption: e.encryption };
  },
  directory(c, e) {
    c.directory = e.rooms;
    c.online = e.online;
    c.uptime = e.uptime;
    c.foundDirectory = true;
  },
  identity(c, e) {
    if (!c.identity) return;
    c.identity.trip = e.trip;
    c.save();
  },
  nick(c, e) {
    if (!c.identity) return;
    c.identity.nick = e.nick;
    c.save();
  },
  color(c, e) {
    if (!c.identity || (e.color !== "" && !colorPattern.test(e.color))) return;
    c.identity.color = e.color;
    c.save();
    c.notice(
      e.color ? "colorSet" : "colorReset",
      c.current,
      e.color ? { params: { color: e.color } } : {},
    );
  },
  moderation(c, e) {
    if (!c.rooms.has(e.room)) return;
    const { code, params, removed } = describeModeration(e, c.identity?.trip);
    if (code) c.notice(code, e.room, { params });
    if (removed) {
      c.notice(removed, e.room, { params: { by: params.by, room: e.room } });
      c.part(e.room);
    }
  },
  // The relay sends a room snapshot on every join and after topic changes.
  state(c, e) {
    const room = c.rooms.get(e.room);
    if (!room) return;
    const prev = room.live;
    if (!room.joined) {
      const code = room.log.length ? "rejoined" : "joinedRoom";
      if (room.log.at(-1)?.code !== code)
        c.notice(code, e.room, { params: { room: e.room }, quiet: true });
    } else if (prev && prev.topic !== e.topic)
      c.notice(e.topic ? "topicChanged" : "topicCleared", e.room, {
        params: { topic: e.topic },
      });
    room.live = e;
    room.parted = false;
    if (room.listed !== e.public) {
      room.listed = e.public;
      c.save();
    }
    room.joined = true;
    c.flush();
  },
  member(c, e) {
    const room = c.rooms.get(e.room);
    if (!room?.live) return;
    room.live = {
      ...room.live,
      users: applyMember(room.live.users, e.action, e.user),
    };
    if (e.action !== "color") presence(c, e);
  },
  notice: presence,
  message(c, e) {
    const room = c.rooms.get(e.room);
    if (!room || c.ignored.includes(e.trip)) return;
    c.add(e.room, e);
    if (room.live)
      room.live = {
        ...room.live,
        users: touch(room.live.users, e.nick, e.trip, e.time),
      };
  },
  pulse(c, e) {
    const room = c.rooms.get(e.room);
    if (room?.live) room.live = { ...room.live, pulse: e.pulse };
  },
  pong(c, e) {
    c.rtt = Date.now() - Number(e.id);
  },
  ack(c, e) {
    const m = c.outbox.find(e.id);
    if (!m || !c.identity) return;
    const room = c.rooms.get(m.room);
    if (room) room.acknowledged = Date.now();
    if (m.kind !== "topic")
      c.add(m.room, {
        ...m,
        time: m.created,
        ref: e.ref,
        nick: m.nick,
        trip: c.identity.trip,
        color: c.identity.color || undefined,
      });
    c.outbox.acked(e.id, Date.now());
    c.save();
    c.flush();
  },
  limited(c, e) {
    const m = c.outbox.find(e.id);
    if (!m) return;
    c.outbox.limited(m, e.wait, Date.now());
    c.save();
  },
  error(c, e) {
    const m = c.outbox.find(e.id);
    if (m) {
      c.outbox.failed(m.id);
      c.notice(e.code, m.room, {
        text: rejected(e),
        unsent: m.raw,
        warn: true,
      });
      if (!c.composer.draft && c.current === m.room) c.composer.draft = m.raw;
      c.save();
    } else if (e.request === "join" && e.room && c.rooms.has(e.room)) {
      c.notice(e.code, e.room, { text: rejected(e), warn: true });
      if (e.code === "room_banned" || e.code === "room_locked") c.part(e.room);
      if (e.code !== "room_banned")
        c.notice("retryJoin", e.room, { params: { room: e.room } });
    } else c.notice(e.code, c.current, { text: rejected(e), warn: true });
  },
};

export function dispatch(client: ChatClient, event: ServerEvent) {
  if (!Object.hasOwn(handlers, event.op)) return;
  const handler = handlers[event.op] as (c: ChatClient, e: ServerEvent) => void;
  handler(client, event);
}
