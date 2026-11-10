// Wire shapes follow internal/protocol/events.go. Fields the relay may add
// later are ignored; fields older relays omit are optional here.

export type Status =
  "connecting" | "connected" | "reconnecting" | "unsupported";

export interface ConnectionInfo {
  transport: string;
  encryption: string;
}

export interface Member {
  id: number;
  nick: string;
  trip: string;
  /** Unix seconds of the member's last message or join. */
  active: number;
  color?: string;
}

/** A room snapshot. Moderation fields are absent before the first state. */
export interface RoomState {
  users: Member[];
  topic: string;
  pulse: number[];
  public?: boolean;
  owner?: string;
  mods?: string[];
  banned?: string[];
  muted?: string[];
  locked?: boolean;
  topicLocked?: boolean;
  slow?: number;
}

export interface DirectoryRoom {
  name: string;
  online: number;
  pulse: number[];
  topic: string;
  public: boolean;
  locked?: boolean;
}

export type ModerationAction =
  | "kick"
  | "ban"
  | "unban"
  | "mute"
  | "unmute"
  | "op"
  | "deop"
  | "slow"
  | "lock"
  | "topiclock"
  | "public";

export type ServerEvent =
  | ({ op: "connection" } & ConnectionInfo)
  | { op: "directory"; rooms: DirectoryRoom[]; online: number; uptime: number }
  | { op: "identity"; trip: string }
  | { op: "nick"; nick: string }
  | { op: "color"; color: string }
  | ({ op: "state"; room: string; public: boolean } & RoomState)
  | {
      op: "member";
      room: string;
      action: "join" | "leave" | "nick" | "color";
      user: Member;
      text: string;
    }
  | {
      op: "notice";
      room: string;
      action: string;
      user?: Member;
      text: string;
    }
  | {
      op: "message";
      room: string;
      ref: string;
      nick: string;
      trip: string;
      kind: SendKind;
      text: string;
      time: number;
      to?: string;
      color?: string;
    }
  | { op: "pulse"; room: string; pulse: number[] }
  | { op: "pong"; id: string }
  | { op: "ack"; id: string; ref: string }
  | { op: "limited"; id: string; wait: number }
  | {
      op: "moderation";
      room: string;
      action: ModerationAction;
      by?: Partial<Member>;
      target: string;
      nick: string;
      on: boolean;
      rate: number;
    }
  | {
      op: "error";
      code: string;
      text?: string;
      id?: string;
      room?: string;
      request?: string;
    };

export type EventOf<Op extends ServerEvent["op"]> = Extract<
  ServerEvent,
  { op: Op }
>;

export type SendKind = "chat" | "me" | "whisper" | "topic";

/** A queued send. Kept in sessionStorage until the relay acknowledges it. */
export interface Outgoing {
  op: "send";
  kind: SendKind;
  room: string;
  text: string;
  to: string;
  /** What the user typed, shown while pending and restored on failure. */
  raw: string;
  nick: string;
  id: string;
  created: number;
  /** Set on the first transmission; a later retry may duplicate delivery. */
  attempt?: number;
  boot?: string;
}

export type ClientCommand =
  | { op: "directory"; known: string[] }
  | {
      op: "identity";
      rosterDelta: true;
      nick: string;
      proof: string;
      color?: string;
    }
  | { op: "join"; room: string; public: boolean }
  | { op: "leave"; room: string }
  | { op: "nick"; nick: string }
  | { op: "color"; color: string }
  | { op: "ping"; id: string }
  | Pick<Outgoing, "op" | "kind" | "room" | "text" | "to" | "id">
  | ({ op: "moderate"; room: string; action: ModerationAction } & Partial<{
      target: string;
      on: boolean;
      rate: number;
    }>);

export interface Identity {
  nick: string;
  /** PBKDF2 output or random bytes, hex. The relay hashes it into the trip. */
  proof: string;
  /** Empty until the relay confirms the identity. */
  trip: string;
  color: string;
}

export type Params = Record<string, string | number | undefined>;

/** A part of a merged presence row. */
export interface NoticePart {
  code?: string;
  params?: Params;
  text?: string;
}

/**
 * One row of a channel log. Relay messages keep their wire fields; local
 * notices carry a translation `code` so stored rows follow the display language.
 */
export interface LogEntry {
  kind: SendKind | "sys" | "presence";
  text: string;
  time: number;
  ref?: string;
  nick?: string;
  trip?: string;
  to?: string;
  color?: string;
  code?: string;
  params?: Params;
  parts?: NoticePart[];
  /** Input the relay rejected, shown after the notice. */
  unsent?: string;
  warn?: boolean;
  /** Does not count as unread. */
  quiet?: boolean;
}
