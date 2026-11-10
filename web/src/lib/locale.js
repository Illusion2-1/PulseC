import { derived, writable } from "svelte/store";
import { chooseLocale, translator } from "./messages.js";

export const language = writable("zh-CN");
export const t = derived(language, translator);
export const clock = derived(language, (value) => {
  const formatter = new Intl.DateTimeFormat(value, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return (time) => formatter.format(time);
});
export const date = derived(language, (value) => {
  const formatter = new Intl.DateTimeFormat(value, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  return (time) => formatter.format(time);
});

export function loadLanguage() {
  let preference;
  try {
    preference = localStorage.getItem("pulsec.language");
  } catch {}
  setLanguage(chooseLocale(preference, navigator.languages), false);
}

export function setLanguage(value, remember = true) {
  language.set(value);
  document.documentElement.lang = value;
  if (remember) {
    try {
      localStorage.setItem("pulsec.language", value);
    } catch {}
  }
}
