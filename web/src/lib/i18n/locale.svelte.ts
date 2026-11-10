import { storageKeys } from "../config";
import type { Params } from "../types";
import { chooseLocale, translator, type Locale } from "./translate";

// The display language is a browser preference shared by all tabs.
class LocaleState {
  language = $state<Locale>("zh-CN");
  t = $derived(translator(this.language));
  #clock = $derived(
    new Intl.DateTimeFormat(this.language, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }),
  );
  #date = $derived(
    new Intl.DateTimeFormat(this.language, {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    }),
  );
  clock = (time: number) => this.#clock.format(time);
  date = (time: number) => this.#date.format(time);

  load() {
    let preference: string | null = null;
    try {
      preference = localStorage.getItem(storageKeys.language);
    } catch {}
    this.set(chooseLocale(preference, navigator.languages), false);
  }

  set(value: Locale, remember = true) {
    this.language = value;
    document.documentElement.lang = value;
    if (remember) {
      try {
        localStorage.setItem(storageKeys.language, value);
      } catch {}
    }
  }
}

export const locale = new LocaleState();

// Reading these inside a template or $derived tracks the language.
export const t = (
  key: string | undefined,
  params?: Params,
  fallback?: string,
) => locale.t(key, params, fallback);
export const clock = (time: number) => locale.clock(time);
export const date = (time: number) => locale.date(time);
