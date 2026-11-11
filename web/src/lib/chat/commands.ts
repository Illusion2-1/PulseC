import { limits } from "../config";
import { normalizeHex } from "../core/colors";
import {
  handle,
  handlePattern,
  nickPattern,
  tripPattern,
} from "../core/identity";
import type { ModerationAction, SendKind } from "../types";
import type { ChatClient } from "./client.svelte";
import { resolveTarget } from "./moderation";

/**
 * What a slash command asks the client to do next:
 * nothing (handled), keep the draft for correction, or send a message.
 */
export type Outcome =
  void | "keep" | { kind: SendKind; text: string; to?: string };

type Handler = (client: ChatClient, arg: string, name: string) => Outcome;

const connected = (c: ChatClient) => c.status === "connected";

const moderate: Handler = (c, arg, name) => {
  const action = name.slice(1) as ModerationAction;
  const found = resolveTarget(c.state, arg, action === "unban");
  if ("error" in found) return c.notice(found.error);
  if (action === "ban" && !c.confirm("banConfirm", { name: arg.trim() }))
    return;
  c.moderate(action, { target: found.trip });
};

const toggle =
  (action: ModerationAction, on: boolean): Handler =>
  (c) =>
    c.moderate(action, { on });

const quiet = (c: ChatClient, arg: string, ignore: boolean) => {
  const trip = arg.split("#").at(-1)!;
  if (!tripPattern.test(trip) || trip === c.identity?.trip)
    return c.notice("needTrip");
  if (ignore) {
    if (c.ignored.length >= limits.ignored && !c.ignored.includes(trip))
      return c.notice("muteFull");
    c.ignored = [...new Set([...c.ignored, trip])];
    c.notice("muted");
  } else {
    c.ignored = c.ignored.filter((id) => id !== trip);
    c.notice("unmuted");
  }
  c.save();
};

const say =
  (kind: "me" | "topic"): Handler =>
  (c, arg) =>
    arg ? { kind, text: arg } : c.notice("needText");

// Key order is the order of command suggestions in the composer.
export const commands = {
  "/join": (c, arg) => c.join(arg.replace(/^#/, "")),
  "/leave": (c) => c.leave(),
  "/nick": (c, arg) => {
    if (!nickPattern.test(arg) || !connected(c))
      return c.notice("connectedNick");
    c.send({ op: "nick", nick: arg });
  },
  "/me": say("me"),
  "/w": (c, arg) => {
    const match = arg.match(/^(\S+)\s+([\s\S]+)/);
    if (!match) {
      c.notice("whisperUsage");
      return "keep";
    }
    let to = match[1];
    if (!handlePattern.test(to)) {
      const users = c.state.users.filter((u) => u.nick === to);
      if (users.length !== 1) {
        c.notice(users.length ? "ambiguous_recipient" : "recipient_required");
        return "keep";
      }
      to = handle(users[0]);
    }
    return { kind: "whisper", to, text: match[2] };
  },
  "/topic": say("topic"),
  "/users": (c) =>
    c.notice(undefined, c.current, {
      text: c.state.users.map(handle).join("  "),
    }),
  "/clear": (c) => c.clearLog(),
  "/help": (c) => c.notice("help"),
  "/cancel": (c) => {
    c.outbox.cancel(c.current);
    c.save();
    c.notice("canceled");
  },
  "/ignore": (c, arg) => quiet(c, arg, true),
  "/unignore": (c, arg) => quiet(c, arg, false),
  "/forget": (c) => c.forget(),
  "/color": (c, arg) => {
    if (!arg.trim()) {
      if (!connected(c)) return c.notice("needConnection");
      return c.send({ op: "color", color: "" });
    }
    const hex = normalizeHex(arg);
    if (!hex) {
      c.notice("colorUsage");
      return "keep";
    }
    if (!connected(c)) return c.notice("needConnection");
    c.send({ op: "color", color: hex });
  },
  "/kick": moderate,
  "/ban": moderate,
  "/unban": moderate,
  "/mute": moderate,
  "/unmute": moderate,
  "/op": moderate,
  "/deop": moderate,
  "/slow": (c, arg) => {
    const rate = Number(arg.trim() || "-1");
    if (!Number.isInteger(rate) || rate < 0 || rate > 5) {
      c.notice("slowUsage");
      return "keep";
    }
    c.moderate("slow", { rate, on: rate > 0 });
  },
  "/lock": toggle("lock", true),
  "/unlock": toggle("lock", false),
  "/locktopic": toggle("topiclock", true),
  "/unlocktopic": toggle("topiclock", false),
  "/public": toggle("public", true),
  "/private": toggle("public", false),
} satisfies Record<string, Handler>;

export const commandNames = Object.keys(commands);

/**
 * Splits a draft into a command call. Input starting with "//" is a message
 * that begins with "/". Returns null for ordinary messages.
 */
export function parseCommand(raw: string) {
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  const [, name = "", arg = ""] = raw.match(/^(\S+)(?:\s+([\s\S]*))?$/) || [];
  return { name, arg };
}

export function runCommand(
  client: ChatClient,
  name: string,
  arg: string,
): Outcome | "unknown" {
  if (!Object.hasOwn(commands, name)) return "unknown";
  return (commands as Record<string, Handler>)[name](client, arg, name);
}
