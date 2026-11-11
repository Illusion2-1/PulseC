import { tick } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { limits, storageKeys } from "../config";
import { handle, handlePattern, roomPattern } from "../core/identity";
import { isAdmin } from "../core/roster";
import { mentions } from "../core/text";
import { t } from "../i18n/locale.svelte";
import { History } from "../platform/history";
import {
  forgetChatData,
  readJSON,
  webStore,
  writeJSON,
  type Store,
} from "../platform/storage";
import { connect, type Connect, type Transport } from "../platform/transport";
import type {
  ClientCommand,
  ConnectionInfo,
  DirectoryRoom,
  Identity,
  LogEntry,
  ModerationAction,
  Outgoing,
  Params,
  Status,
} from "../types";
import { parseCommand, runCommand } from "./commands";
import { ComposerState } from "./composer.svelte";
import { dispatch } from "./events";
import { Outbox, deliveryUnknown } from "./outbox.svelte";
import { blankState, Room } from "./room.svelte";
import { restoreKnown, restoreSession } from "./session";
import { ViewState } from "./view.svelte";

export interface ChatDeps {
  connect: Connect;
  session: Store;
  local: Store;
  confirm(message: string): boolean;
  /** Returns to the entrance after leaving the last channel. */
  reload(): void;
  /** Reloads the page without the query string. */
  restart(): void;
}

export const browserDeps = (): ChatDeps => ({
  connect,
  session: webStore("sessionStorage"),
  local: webStore("localStorage"),
  confirm: (message) => window.confirm(message),
  reload: () => {
    const url = new URL(location.href);
    url.searchParams.delete("ch");
    location.replace(url);
  },
  restart: () => location.replace(location.pathname),
});

type Details = Partial<LogEntry> & { params?: Params };

/**
 * The chat application: one connection, the tab's identity and its open
 * channels. Components read its state and call its methods; protocol events
 * are applied in ./events, slash commands in ./commands.
 */
export class ChatClient {
  status = $state<Status>("connecting");
  connection = $state.raw<ConnectionInfo | null>(null);
  /** Updated twice a second; drives clocks, idle markers and cooldowns. */
  now = $state(Date.now());
  directory = $state.raw<DirectoryRoom[]>([]);
  online = $state(0);
  uptime = $state(0);
  foundDirectory = $state(false);
  /** The error shown at the entrance, where there is no channel log. */
  entryError = $state<Details | null>(null);
  identity = $state<Identity | null>(null);
  current = $state("");
  rooms = new SvelteMap<string, Room>();
  known = $state.raw<string[]>([]);
  ignored = $state.raw<string[]>([]);
  rtt = $state<number | null>(null);
  cacheError = $state("");
  /** Identifies the relay process; a send attempted on another may be lost. */
  boot = "";
  /** Rows that arrived in the open channel while the browser tab was hidden. */
  hidden = false;
  away = $state.raw<LogEntry[]>([]);
  awayMention = $state(false);
  firstUnread = $state.raw<LogEntry | null>(null);
  unreadCount = $state(0);

  readonly outbox = new Outbox();
  readonly view = new ViewState();
  readonly composer: ComposerState;
  readonly deps: ChatDeps;
  readonly history: History;
  #link: Transport | undefined;

  constructor(deps: ChatDeps) {
    this.deps = deps;
    this.history = new History(deps.session);
    this.composer = new ComposerState({
      users: () => this.state.users,
      self: () => handle(this.identity || {}),
    });
  }

  room = $derived(this.rooms.get(this.current));
  state = $derived(this.room?.state ?? blankState);
  items = $derived(
    (this.room?.log ?? []).filter(
      (m) => !m.trip || !this.ignored.includes(m.trip),
    ),
  );
  admin = $derived(isAdmin(this.state, this.identity?.trip));
  left = $derived(this.outbox.left(this.now));
  pending = $derived(
    [...this.rooms.values()].reduce(
      (sum, r) => sum + (r.name === this.current ? 0 : r.unread),
      0,
    ) + this.away.length,
  );
  pinged = $derived(
    this.awayMention ||
      [...this.rooms.values()].some(
        (r) => r.mentioned && r.name !== this.current,
      ),
  );

  confirm(key: string, params?: Params) {
    return this.deps.confirm(t(key, params));
  }

  send(command: ClientCommand) {
    this.#link?.send(command);
  }

  /** Connects and starts the clock. Call restore() first. Returns a stop function. */
  start() {
    this.#link = this.deps.connect({
      status: (s) => {
        this.status = s;
        if (s !== "connected") {
          this.connection = null;
          for (const room of this.rooms.values()) room.reset();
          this.outbox.disconnected();
          this.rtt = null;
        }
      },
      opened: (boot) => {
        this.boot = boot;
        this.#authorize();
        this.heartbeat();
      },
      received: (e) => dispatch(this, e),
      heartbeat: () => this.heartbeat(),
    });
    const timer = setInterval(() => {
      this.now = Date.now();
      this.flush();
    }, 500);
    return () => {
      clearInterval(timer);
      this.#link?.close();
    };
  }

  /** Loads the tab's saved session and remembered channels. */
  restore() {
    const saved = restoreSession(
      readJSON(this.deps.session, storageKeys.session, {}),
    );
    this.identity = saved.identity;
    for (const [name, listed] of saved.rooms) this.#open(name, listed);
    this.current = saved.current;
    this.outbox.queue = saved.queue;
    this.ignored = saved.ignored;
    this.known = restoreKnown(
      readJSON(this.deps.local, storageKeys.channels, []),
    );
  }

  #open(name: string, listed: boolean) {
    let log: LogEntry[] = [];
    try {
      log = this.history.read(name);
    } catch {
      this.cacheError = "cacheUnavailable";
    }
    const room = new Room(name, listed, log, this.history.count(name));
    this.rooms.set(name, room);
    return room;
  }

  save() {
    try {
      writeJSON(this.deps.session, storageKeys.session, {
        identity: this.identity,
        current: this.current,
        rooms: Object.fromEntries(
          [...this.rooms].map(([name, r]) => [name, r.listed]),
        ),
        queue: this.outbox.queue,
        ignored: this.ignored,
      });
    } catch {
      this.cacheError = "cacheUnavailable";
    }
  }

  #authorize() {
    if (!this.identity) return;
    const { nick, proof, color } = this.identity;
    this.send({
      op: "identity",
      rosterDelta: true,
      nick,
      proof,
      color: color || "",
    });
    for (const room of this.rooms.values())
      if (!room.parted)
        this.send({ op: "join", room: room.name, public: room.listed });
  }

  heartbeat() {
    if (!this.current) this.send({ op: "directory", known: this.known });
    else this.send({ op: "ping", id: String(Date.now()) });
  }

  /** Appends a row to an open channel's log and updates unread state. */
  add(name: string, m: LogEntry) {
    const room = this.rooms.get(name);
    if (!room || (m.ref && room.log.some((x) => x.ref === m.ref))) return;
    const stick = this.view.atBottom();
    const prev = room.log.at(-1);
    const merge =
      m.kind === "presence" &&
      prev?.kind === "presence" &&
      m.time - prev.time < 10000 &&
      prev.text.length < 256;
    if (merge)
      m = {
        ...m,
        text: prev.text + "   " + m.text,
        parts: [...(prev.parts || [{ text: prev.text }]), ...(m.parts || [])],
      };
    room.log = merge
      ? [...room.log.slice(0, -1), m]
      : [...room.log.slice(-(limits.history - 1)), m];
    if (!merge) room.total++;
    try {
      this.history.append(name, m, merge);
    } catch {
      this.cacheError = "cacheUnavailable";
    }
    const self = this.identity;
    const pinged =
      !!m.trip &&
      m.trip !== self?.trip &&
      (m.kind === "whisper" || mentions(m.text, self?.nick));
    if (name !== this.current) {
      if (!merge && !m.quiet) room.unread++;
      if (pinged) room.mentioned = true;
    } else {
      if (this.hidden && m.trip && m.trip !== self?.trip) {
        this.away = [...this.away, m].slice(-limits.history);
        if (pinged) this.awayMention = true;
      }
      if (stick) this.view.bottom();
      else this.view.below++;
    }
  }

  /** A local notice in a channel log, or at the entrance when `room` is "". */
  notice(code: string | undefined, room = this.current, details: Details = {}) {
    const event: LogEntry = {
      kind: "sys",
      code,
      text: t(code, details.params, details.text),
      time: Date.now(),
      ...details,
    };
    if (room) this.add(room, event);
    else this.entryError = event;
  }

  /** The relay no longer has us in this room. Keep the tab and its history. */
  part(name: string) {
    const room = this.rooms.get(name);
    if (!room) return;
    room.reset();
    room.parted = true;
    const dropped = this.outbox.drop(name);
    if (dropped.length) {
      for (const q of dropped)
        this.notice("not_joined", name, { unsent: q.raw, warn: true });
      this.save();
    }
  }

  visibility(hidden: boolean) {
    this.hidden = hidden;
    if (hidden || !this.away.length) return;
    const list = this.room?.log ?? [];
    const first = this.away.find((m) => list.includes(m));
    if (first) {
      this.firstUnread = first;
      this.unreadCount = list.length - list.indexOf(first);
    }
    this.away = [];
    this.awayMention = false;
  }

  enter(nick: string, proof: string, name: string, listed: boolean) {
    this.identity = { nick, proof, trip: "", color: "" };
    this.send({ op: "identity", rosterDelta: true, nick, proof });
    this.join(name, listed);
  }

  select(name: string) {
    if (name === this.current) return this.composer.focus();
    const room = this.rooms.get(name);
    this.current = name;
    this.unreadCount = Math.min(room?.unread || 0, room?.log.length || 0);
    this.firstUnread = this.unreadCount
      ? room!.log.at(-this.unreadCount)!
      : null;
    if (room) {
      room.unread = 0;
      room.mentioned = false;
    }
    this.away = [];
    this.awayMention = false;
    this.view.membersOpen = false;
    this.composer.draft = "";
    this.save();
    this.view.bottom();
    tick().then(() => this.composer.focus());
  }

  join(name: string, listed = false) {
    if (!roomPattern.test(name)) return this.notice("invalid_room");
    let room = this.rooms.get(name);
    if (!room) {
      if (this.rooms.size >= limits.rooms) return this.notice("room_limit");
      room = this.#open(name, listed);
      this.#remember(name);
    }
    if (!room.joined) {
      room.parted = false;
      this.send({ op: "join", room: name, public: room.listed });
    }
    this.select(name);
  }

  leave(all = false) {
    const leaving = all ? [...this.rooms.keys()] : [this.current];
    if (this.outbox.queue.some((q) => leaving.includes(q.room)))
      return this.notice("leavePending");
    for (const name of leaving) {
      if (!this.rooms.get(name)?.parted) this.send({ op: "leave", room: name });
      this.rooms.delete(name);
    }
    const next = this.rooms.keys().next().value;
    if (next) return this.select(next);
    this.identity = null;
    this.current = "";
    this.save();
    this.deps.reload();
  }

  /** Transmits the oldest queued send once its room is joined and the rate allows. */
  flush() {
    const m = this.outbox.queue[0];
    const now = Date.now();
    if (
      !m ||
      this.outbox.inflight ||
      now < this.outbox.until ||
      !this.rooms.get(m.room)?.joined ||
      !this.identity?.trip
    )
      return;
    // Older tabs could persist a nickname without the recipient's identity.
    const unboundWhisper = m.kind === "whisper" && !handlePattern.test(m.to);
    if (deliveryUnknown(m, this.boot, now) || (unboundWhisper && m.attempt)) {
      this.outbox.remove(m.id);
      this.notice("uncertain", m.room, { params: { raw: m.raw } });
      this.save();
      return;
    }
    if (unboundWhisper) {
      this.outbox.remove(m.id);
      this.notice("recipient_required", m.room, { unsent: m.raw, warn: true });
      this.save();
      return;
    }
    this.outbox.inflight = m.id;
    if (!m.attempt) {
      m.attempt = now;
      m.boot = this.boot;
      this.save();
    }
    const { op, kind, room, text, to, id } = m;
    this.send({ op, kind, room, text, to, id });
  }

  /** Sends the composer draft as a message or runs it as a slash command. */
  submit() {
    const composer = this.composer;
    const raw = composer.draft.trimEnd();
    if (!raw.trim() || !this.identity) return;
    if ([...raw].length > limits.text) return this.notice("invalid_text");
    const keep = (code: string, params?: Params) => {
      composer.draft = raw;
      this.notice(code, this.current, params ? { params } : {});
    };
    let message: { kind: Outgoing["kind"]; text: string; to?: string } = {
      kind: "chat",
      text: raw.replace(/^\/\//, "/"),
    };
    const command = parseCommand(raw);
    if (command) {
      composer.draft = "";
      const outcome = runCommand(this, command.name, command.arg);
      if (outcome === "unknown") return keep("unknownCommand");
      if (outcome === "keep") composer.draft = raw;
      if (!outcome || outcome === "keep") return;
      message = outcome;
    }
    const room = this.room;
    if (room?.parted) return keep("parted", { room: this.current });
    if (this.state.muted?.includes(this.identity.trip) && !this.admin)
      return keep("room_muted");
    if (message.kind === "topic" && this.state.topicLocked && !this.admin)
      return keep("topic_locked");
    if (
      this.outbox.queue.length >= limits.queue ||
      Date.now() < this.outbox.until
    )
      return keep("queueFull");
    if (this.left === 0 && this.status === "connected") {
      this.outbox.until = Date.now() + 4000;
      return keep("retained");
    }
    composer.lastInput = raw;
    composer.draft = "";
    this.outbox.push({
      op: "send",
      kind: message.kind,
      room: this.current,
      text: message.text,
      to: message.to || "",
      raw,
      nick: this.identity.nick,
      id: crypto.randomUUID(),
      created: Date.now(),
    });
    this.save();
    this.flush();
  }

  moderate(
    action: ModerationAction,
    extra: { target?: string; on?: boolean; rate?: number } = {},
  ) {
    if (this.status !== "connected") return this.notice("needConnection");
    if (!this.admin) return this.notice("not_admin");
    this.send({ op: "moderate", room: this.current, action, ...extra });
  }

  clearLog() {
    if (this.room) {
      this.room.log = [];
      this.room.total = 0;
    }
    try {
      this.history.clear(this.current);
    } catch {
      this.cacheError = "cacheUnavailable";
    }
  }

  jump(ref: string) {
    if (!this.view.jump(ref)) this.notice("missingRef");
  }

  forget() {
    if (!this.confirm("forgetConfirm")) return;
    try {
      forgetChatData(this.deps.session, this.deps.local);
    } catch {
      this.notice("forgetFailed");
      return;
    }
    this.#link?.close();
    this.deps.restart();
  }

  #remember(name: string) {
    this.known = [name, ...this.known.filter((n) => n !== name)].slice(
      0,
      limits.known,
    );
    try {
      writeJSON(this.deps.local, storageKeys.channels, this.known);
    } catch {}
  }
}
