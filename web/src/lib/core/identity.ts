// Names, trips and the credential a password derives. Trips must match what
// the relay computes, so the derivation constants here are part of the protocol.

export const nickPattern = /^[\p{L}\p{N}_-]{1,16}$/u;
export const roomPattern = /^[\p{L}\p{N}_-]{1,24}$/u;
export const tripPattern = /^[a-f0-9]{16}$/;
export const proofPattern = /^[a-f0-9]{64}$/;
export const colorPattern = /^#[a-f0-9]{6}$/;

interface Named {
  nick?: string;
  trip?: string;
}

/** The full `nick#trip` handle used for whispers and display. */
export const handle = (u: Named) => (u.nick || "") + "#" + (u.trip || "");

/** The shortened `nick#abcde` form used in moderation notices. */
export const shortHandle = (u: Named) =>
  (u.nick || "") + "#" + (u.trip || "").slice(0, 5);

/** Whether someone else in the roster uses this nick with a different trip. */
export function clash(
  nick: string | undefined,
  trip: string | undefined,
  users: Named[],
) {
  return users.some((u) => u.nick === nick && u.trip !== trip);
}

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");

const encoder = new TextEncoder();
const version = "PulseC trip v1/";

async function sha256(text: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

/** A proof for a temporary identity that cannot be repeated. */
export function randomProof() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

/** The repeatable proof for a password. The origin keeps sites apart. */
export async function deriveProof(password: string, origin: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(version + origin),
      iterations: 310000,
    },
    key,
    256,
  );
  return hex(bits);
}

/** The trip the relay will assign to a proof. */
export async function tripOf(proof: string) {
  return (await sha256(version + proof)).slice(0, 16);
}
