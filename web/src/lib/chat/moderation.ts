import { shortHandle, tripPattern } from "../core/identity";
import type { EventOf, Params, RoomState } from "../types";

export type Resolved =
  { trip: string } | { error: "needTarget" | "ambiguousTarget" };

/**
 * Resolves a typed target to one trip: a full trip, `nick#trip`, or a nick
 * shared by one identity. /unban also matches a trip prefix on the ban list.
 */
export function resolveTarget(
  state: RoomState,
  text: string,
  unban = false,
): Resolved {
  const word = text.trim();
  if (!word) return { error: "needTarget" };
  const [nick, trip] = word.includes("#") ? word.split("#") : [word, ""];
  if (tripPattern.test(word)) return { trip: word };
  if (unban) {
    const hit = (state.banned || []).filter(
      (t) => t === trip || t.startsWith(word),
    );
    if (hit.length === 1) return { trip: hit[0] };
  }
  const hits = [
    ...new Set(
      state.users
        .filter((u) =>
          trip ? u.nick === nick && u.trip === trip : u.nick === nick,
        )
        .map((u) => u.trip),
    ),
  ];
  if (hits.length === 1) return { trip: hits[0] };
  return { error: hits.length ? "ambiguousTarget" : "needTarget" };
}

const actions: Record<string, string> = {
  kick: "modKick",
  ban: "modBan",
  unban: "modUnban",
  mute: "modMute",
  unmute: "modUnmute",
  op: "modOp",
  deop: "modDeop",
};
const toggles: Record<string, [on: string, off: string]> = {
  slow: ["modSlow", "modSlowOff"],
  lock: ["modLock", "modUnlock"],
  topiclock: ["modTopicLock", "modTopicUnlock"],
  public: ["modPublic", "modPrivate"],
};

export interface ModerationNotice {
  /** The room-wide notice, if the action is known. */
  code?: string;
  params: Params;
  /** Set when this tab's identity was removed from the room. */
  removed?: "youKicked" | "youBanned";
}

/** Describes a relay moderation event from the point of view of `self`. */
export function describeModeration(
  e: EventOf<"moderation">,
  self: string | undefined,
): ModerationNotice {
  const by = shortHandle(e.by || {});
  const params = {
    by,
    target: shortHandle({ nick: e.nick, trip: e.target }),
    rate: e.rate,
  };
  const toggle = toggles[e.action];
  const code = actions[e.action] || (toggle && toggle[e.on ? 0 : 1]);
  const removed =
    (e.action === "kick" || e.action === "ban") && e.target === self
      ? e.action === "kick"
        ? "youKicked"
        : "youBanned"
      : undefined;
  return { code, params, removed };
}
