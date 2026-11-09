<script>
  import { t } from "./locale.js";
  import { tick } from "svelte";
  export let confirmed;
  export let draft = "",
    users,
    identity,
    until,
    now,
    left,
    lastInput,
    bottom,
    send;
  let area,
    selection = 0,
    dismissed = false;
  export function focus() {
    area?.focus();
  }
  export function insert(text) {
    draft += text;
    dismissed = false;
    tick().then(focus);
  }
  const commands = [
    "/join",
    "/leave",
    "/nick",
    "/me",
    "/w",
    "/topic",
    "/users",
    "/clear",
    "/help",
    "/cancel",
    "/ignore",
    "/unignore",
    "/forget",
  ];
  $: suggestions = dismissed
    ? []
    : draft.match(/^\/\S*$/)
      ? commands.filter((x) => x.startsWith(draft))
      : draft.match(/@[\p{L}\p{N}_-]*$/u)
        ? users
            .filter((u) => u.nick.startsWith(draft.split("@").pop()))
            .map((u) => "@" + u.nick + "#" + u.trip)
        : [];
  function pick(s) {
    draft = s.startsWith("@")
      ? draft.replace(/@[^\s]*$/, s.split("#")[0] + " ")
      : s + " ";
    dismissed = true;
    area?.focus();
  }
  function keys(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      dismissed = true;
      bottom();
      return;
    }
    if (suggestions.length && ["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      selection =
        (selection +
          (e.key === "ArrowDown" ? 1 : -1) +
          Math.min(suggestions.length, 9)) %
        Math.min(suggestions.length, 9);
      return;
    }
    if (e.key === "Tab" && suggestions.length) {
      e.preventDefault();
      return pick(suggestions[selection] || suggestions[0]);
    }
    if (e.key === "Tab") {
      const word = draft.match(/[\p{L}\p{N}_-]+$/u);
      const u = word && users.find((u) => u.nick.startsWith(word[0]));
      if (u) {
        e.preventDefault();
        draft = draft.slice(0, -word[0].length) + "@" + u.nick + " ";
        return;
      }
    }
    if (e.key === "ArrowUp" && !draft) {
      e.preventDefault();
      draft = lastInput;
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<div class="input" class:throt={now < until}>
  <span class="ps"
    >{identity.nick}<small class="dim">#{identity.trip?.slice(0, 5)}</small>
    <span class="amb">›</span></span
  >
  <textarea
    aria-label={$t("message")}
    rows="1"
    bind:this={area}
    bind:value={draft}
    on:keydown={keys}
    on:input={() => {
      selection = 0;
      dismissed = false;
    }}
    placeholder={$t("draftHint")}></textarea>
  <span class="meta"
    >{#if confirmed}<span class="ack" role="status"
        >✓ {$t("confirmed")}
      </span>{/if}<span class="wide">{[...draft].length}/2000 </span><span
      class="meter"
      title={$t("remaining", { count: left })}
      >{now < until
        ? $t("cooldown", { seconds: Math.ceil((until - now) / 1000) })
        : "▮".repeat(left) + "▯".repeat(6 - left)}</span
    ></span
  >
  {#if suggestions.length}<div class="pop on">
      {#each suggestions.slice(0, 9) as s, i}<button
          class:sel={selection === i}
          on:click={() => pick(s)}>{s}</button
        >{/each}
    </div>{/if}
</div>
<div class="bar keys">
  <span class="kb"
    ><kbd>⏎</kbd>{$t("send")} <kbd>⇧⏎</kbd>{$t("newline")}
    <kbd>Tab</kbd>{$t("complete")}
    <kbd>↑</kbd>{$t("last")} <kbd>Alt+1–9</kbd>{$t("switch")}
    <kbd>Esc</kbd>{$t("bottom")}</span
  >{#each ["/", "@", ">>", "```\n\n```", "/me ", "/w "] as s}<button
      class="tok"
      on:click={() => insert(s)}>{s.trim()}</button
    >{/each}<button class="tok" on:click={send}>{$t("send")}</button>
</div>
