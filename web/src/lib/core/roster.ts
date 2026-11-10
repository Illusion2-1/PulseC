import type { Member, RoomState } from "../types";

/** Applies one incremental roster change (rosterDelta) to a member list. */
export function applyMember(
  users: Member[],
  action: string,
  user: Member,
): Member[] {
  if (action === "join")
    return [...users.filter((u) => u.id !== user.id), user];
  if (action === "leave") return users.filter((u) => u.id !== user.id);
  if (action === "nick" || action === "color")
    return users.map((u) => (u.id === user.id ? user : u));
  return users;
}

/** Marks every connection of one identity as active at `time` (ms). */
export function touch(
  users: Member[],
  nick: string,
  trip: string,
  time: number,
) {
  return users.map((u) =>
    u.nick === nick && u.trip === trip ? { ...u, active: time / 1000 } : u,
  );
}

/** Whether a trip may administer the room. */
export function isAdmin(state: RoomState, trip: string | undefined) {
  return !!trip && (state.owner === trip || !!state.mods?.includes(trip));
}

/**
 * Whether `self` may act on `trip` from the member list. Admins act on
 * others; only the creator acts on moderators.
 */
export function canManage(state: RoomState, self: string, trip: string) {
  const owner = state.owner || "";
  return (
    isAdmin(state, self) &&
    trip !== self &&
    trip !== owner &&
    (!state.mods?.includes(trip) || self === owner)
  );
}

/** "@" for the creator, "+" for a moderator. */
export function roleOf(state: RoomState, trip: string) {
  return trip === state.owner ? "@" : state.mods?.includes(trip) ? "+" : "";
}

/** Whether a member has been idle for ten minutes at `now` (ms). */
export const idle = (u: Member, now: number) => now / 1000 - u.active >= 600;
