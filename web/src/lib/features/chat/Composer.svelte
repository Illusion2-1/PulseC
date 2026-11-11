<script lang="ts">
  import { useChat } from "#lib/chat/context.ts";
  import { limits } from "#lib/config.ts";
  import { colorOf } from "#lib/core/colors.ts";
  import { t } from "#lib/i18n/locale.svelte.ts";

  const chat = useChat();
  const composer = chat.composer;
  const throttled = $derived(chat.now < chat.outbox.until);
  const confirmed = $derived(chat.now - (chat.room?.acknowledged ?? 0) < 3500);
  const tokens = ["/", "@", ">>", "```\n\n```", "/me ", "/w "];

  function keys(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      composer.dismiss();
      chat.view.bottom();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (composer.move(e.key === "ArrowDown" ? 1 : -1)) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Tab" && composer.complete()) {
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowUp" && composer.recall()) {
      e.preventDefault();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chat.submit();
    }
  }
</script>

<div class="input" class:throt={throttled}>
  <span class="ps"
    ><span style:color={colorOf(chat.identity) || undefined}
      >{chat.identity?.nick}</span
    ><small class="dim">#{chat.identity?.trip.slice(0, 5)}</small>
    <span class="amb">›</span></span
  >
  <textarea
    aria-label={t("message")}
    rows="1"
    bind:this={composer.area}
    bind:value={composer.draft}
    onkeydown={keys}
    oninput={() => composer.typed()}
    placeholder={t("draftHint")}></textarea>
  <span class="meta"
    >{#if confirmed}<span class="ack" role="status"
        >✓ {t("confirmed")}
      </span>{/if}<span class="wide"
      >{[...composer.draft].length}/{limits.text}
    </span>{#if throttled}<span class="cooldown"
        >{t("cooldown", {
          seconds: Math.ceil((chat.outbox.until - chat.now) / 1000),
        })}</span
      >{:else}
      <svg
        class="meter"
        role="meter"
        aria-label={t("sendBudget")}
        aria-valuemin={0}
        aria-valuemax={limits.burst}
        aria-valuenow={chat.left}
        width="{limits.burst}ch"
        height="1em"
        viewBox="0 0 {limits.burst * 6} 10"
        preserveAspectRatio="none"
        stroke="currentColor"
      >
        <title>{t("remaining", { count: chat.left })}</title>
        {#each Array(limits.burst) as _, i}
          <rect
            x={6 * i + 0.5}
            y="0.5"
            width="4"
            height="9"
            fill={i < chat.left ? "currentColor" : "none"}
          />
        {/each}
      </svg>
    {/if}</span
  >
  {#if composer.shown.length}<div class="pop on">
      {#each composer.shown as s, i}<button
          class:sel={composer.selection === i}
          onclick={() => composer.pick(s)}>{s}</button
        >{/each}
    </div>{/if}
</div>
<div class="bar keys">
  <span class="kb"
    ><kbd>⏎</kbd>{t("send")} <kbd>⇧⏎</kbd>{t("newline")}
    <kbd>Tab</kbd>{t("complete")}
    <kbd>↑</kbd>{t("last")} <kbd>Alt+1–9</kbd>{t("switch")}
    <kbd>Esc</kbd>{t("bottom")}</span
  >{#each tokens as s}<button class="tok" onclick={() => composer.insert(s)}
      >{s.trim()}</button
    >{/each}<button class="tok" onclick={() => chat.submit()}
    >{t("send")}</button
  >
</div>
