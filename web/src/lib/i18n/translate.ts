import type { LogEntry, NoticePart, Params } from "../types";
import { messages, warnings } from "./messages";

export type Locale = "zh-CN" | "en";
export const locales: Locale[] = ["zh-CN", "en"];

export type Translate = (
  key: string | undefined,
  params?: Params,
  fallback?: string,
) => string;

export function chooseLocale(
  preference: string | null | undefined,
  languages: readonly string[] | undefined,
): Locale {
  if (preference === "en" || preference === "zh-CN") return preference;
  for (const name of languages || []) {
    if (/^en(?:-|$)/i.test(name)) return "en";
    if (/^zh(?:-|$)/i.test(name)) return "zh-CN";
  }
  return "zh-CN";
}

/** Looks a key up and fills `{name}` fields. Unknown keys return `fallback`. */
export function translator(locale: string): Translate {
  const index = locale === "en" ? 1 : 0;
  const numbers = new Intl.NumberFormat(locale);
  return (key, params = {}, fallback = "") => {
    if (!key || !Object.hasOwn(messages, key)) return fallback;
    const text = messages[key as keyof typeof messages][index];
    return text.replace(/\{(\w+)\}/g, (_, name) => {
      const value = params[name];
      return typeof value === "number" ? numbers.format(value) : (value ?? "");
    });
  };
}

/** Whether a notice reports a failure. Relay error codes are snake_case. */
export function isWarning(message: Partial<LogEntry>) {
  const code = message.code || "";
  return !!message.warn || warnings.has(code) || code.includes("_");
}

/** The text of a stored notice in the current language. */
export function displayEvent(
  t: Translate,
  message: Partial<LogEntry> | NoticePart,
): string {
  if ("parts" in message && message.parts)
    return message.parts.map((part) => displayEvent(t, part)).join("   ");
  const text = t(message.code, message.params, message.text || "");
  return "unsent" in message && message.unsent
    ? text + " · " + t("unsent", { raw: message.unsent })
    : text;
}
