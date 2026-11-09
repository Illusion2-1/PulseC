// Only PulseC's tab-scoped history/credentials and remembered channels are user data.
// Other tabs have independent sessions; the language preference belongs to the browser.
export function forgetChatData(session, local) {
  for (const key of Object.keys(session)) {
    if (key.startsWith("pulsec.row.") || key === "pulsec.session") {
      session.removeItem(key);
    }
  }
  local.removeItem("pulsec.channels");
}

export function readSaved(store, key, fallback) {
  try {
    return JSON.parse(store.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function applyMember(users, action, user) {
  if (action === "join")
    return [...users.filter((u) => u.id !== user.id), user];
  if (action === "leave") return users.filter((u) => u.id !== user.id);
  if (action === "nick") return users.map((u) => (u.id === user.id ? user : u));
  return users;
}

// After a restart or expiry, retrying the same ID may duplicate a delivered message.
export function deliveryUnknown(message, boot, now) {
  return (
    !!message.attempt &&
    (now - message.attempt > 120000 || message.boot !== boot)
  );
}

export const tripPattern = /^[a-f0-9]{16}$/;
