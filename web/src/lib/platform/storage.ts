import { storageKeys } from "../config";

/**
 * The subset of Web Storage PulseC uses. Every method may throw: browsers can
 * deny storage at property access, and writes can exceed the quota.
 */
export interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

/** A Store over `window[name]`, resolved on every call so denial surfaces in the caller's try. */
export function webStore(name: "sessionStorage" | "localStorage"): Store {
  const area = () => window[name];
  return {
    get: (key) => area().getItem(key),
    set: (key, value) => area().setItem(key, value),
    remove: (key) => area().removeItem(key),
    keys: () => Object.keys(area()),
  };
}

/** Parsed JSON, or `fallback` when missing or unreadable. Callers validate the shape. */
export function readJSON(
  store: Store,
  key: string,
  fallback: unknown,
): unknown {
  try {
    return JSON.parse(store.get(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(store: Store, key: string, value: unknown) {
  store.set(key, JSON.stringify(value));
}

// Chat data includes tab history/credentials, channels, saved login and colour.
// Other tabs have independent sessions; the language preference belongs to the browser.
export function forgetChatData(session: Store, local: Store) {
  for (const key of session.keys()) {
    if (key.startsWith(storageKeys.rowPrefix) || key === storageKeys.session) {
      session.remove(key);
    }
  }
  local.remove(storageKeys.channels);
  local.remove(storageKeys.login);
  local.remove(storageKeys.color);
}
