<script lang="ts">
  import { onMount, tick } from "svelte";
  import { useChat } from "#lib/chat/context.ts";
  import { limits } from "#lib/config.ts";
  import { colorOf, normalizeHex } from "#lib/core/colors.ts";
  import { t } from "#lib/i18n/locale.svelte.ts";
  import ColorPicker from "./ColorPicker.svelte";

  const chat = useChat();
  const composer = chat.composer;
  const throttled = $derived(chat.now < chat.outbox.until);
  const confirmed = $derived(chat.now - (chat.room?.acknowledged ?? 0) < 3500);
  const tokens = ["/", "@", ">>", "```\n\n```", "/me ", "/w "];
  const id = $props.id();
  let focused = $state(false);
  let composing = $state(false);
  let scrollTop = $state(0);
  let scrollLeft = $state(0);
  let scrollbar = $state(0);
  const assisting = $derived(focused && !composing && !composer.dismissed);
  const colorOpen = $derived(assisting && composer.command?.name === "/color");
  const listOpen = $derived(
    assisting && !colorOpen && composer.suggestions.length > 0,
  );
  const help = $derived(
    composer.commandState === "valid"
      ? t("cmd_" + composer.command!.name.slice(1))
      : composer.commandState === "invalid"
        ? t("commandUnknown")
        : "",
  );
  const colorPreview = $derived(
    colorOf({
      ...chat.identity,
      color: normalizeHex(composer.command?.arg ?? "") ?? "",
    }),
  );

  function syncPaint() {
    const area = composer.area;
    if (!area) return;
    scrollTop = area.scrollTop;
    scrollLeft = area.scrollLeft;
    scrollbar = area.offsetWidth - area.clientWidth;
  }

  onMount(() => {
    const resize = new ResizeObserver(syncPaint);
    if (composer.area) resize.observe(composer.area);
    return () => resize.disconnect();
  });

  $effect(() => {
    if (composer.selection >= composer.suggestions.length)
      composer.selection = 0;
    const selection = composer.selection;
    if (listOpen)
      tick().then(() => {
        document
          .getElementById(`${id}-option-${selection}`)
          ?.scrollIntoView({ block: "nearest" });
      });
  });

  function pickColor(value: string) {
    composer.draft = "/color" + (value ? " " + value : "");
    composer.cursor = composer.selectionEnd = composer.draft.length;
    composer.dismissed = false;
    composer.selection = 0;
  }

  function finishColor() {
    tick().then(() => {
      composer.focus();
      composer.area?.setSelectionRange(
        composer.draft.length,
        composer.draft.length,
      );
    });
  }

  function keys(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      e.preventDefault();
      const wasAssisting = listOpen || colorOpen;
      composer.dismiss();
      if (!wasAssisting) chat.view.bottom();
      return;
    }
    if ((e.ctrlKey || e.metaKey || e.altKey) && e.key !== "Enter") return;
    if (!e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      if (composer.move(e.key === "ArrowDown" ? 1 : -1)) {
        e.preventDefault();
        return;
      }
    }
    if (
      e.key === "Tab" &&
      (e.shiftKey ? composer.move(-1) : composer.complete())
    ) {
      e.preventDefault();
      return;
    }
    if (
      e.key === "ArrowRight" &&
      !e.shiftKey &&
      composer.ghost &&
      composer.complete()
    ) {
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowUp" && !e.shiftKey && composer.recall()) {
      e.preventDefault();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chat.submit();
    }
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && colorOpen && e.target !== composer.area) {
      composer.dismiss();
      finishColor();
    }
  }}
/>

<div
  class="input"
  class:throt={throttled}
  onfocusin={() => (focused = true)}
  onfocusout={(e) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null))
      focused = false;
  }}
>
  <span class="ps"
    ><span style:color={colorOf(chat.identity) || undefined}
      >{chat.identity?.nick}</span
    ><small class="dim">#{chat.identity?.trip.slice(0, 5)}</small>
    <span class="amb">›</span></span
  >
  <div class="editor" class:composing>
    <div
      class="draft-paint"
      aria-hidden="true"
      style:padding-right={`${scrollbar}px`}
    >
      <div style:transform={`translate(${-scrollLeft}px, ${-scrollTop}px)`}>
        {#if composer.command}<span
            class="command-token {composer.commandState}"
            >{composer.command.name}</span
          >{composer.draft.slice(
            composer.command.name.length,
          )}{:else}{composer.draft}{/if}{#if assisting}<span class="ghost"
            >{composer.ghost}</span
          >{/if}
      </div>
    </div>
    <textarea
      aria-label={t("message")}
      rows="1"
      bind:this={composer.area}
      bind:value={composer.draft}
      onkeydown={keys}
      oninput={() => {
        composer.typed();
        tick().then(syncPaint);
      }}
      onselect={() => composer.syncCursor()}
      onkeyup={() => composer.syncCursor()}
      onclick={() => composer.syncCursor()}
      oncompositionstart={() => (composing = true)}
      oncompositionend={() => {
        composing = false;
        composer.typed();
        tick().then(syncPaint);
      }}
      onscroll={syncPaint}
      aria-autocomplete="both"
      aria-haspopup="listbox"
      aria-controls={listOpen ? `${id}-completions` : undefined}
      aria-activedescendant={listOpen
        ? `${id}-option-${composer.selection}`
        : undefined}
      spellcheck="false"
      placeholder={t("draftHint")}></textarea>
  </div>
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
  {#if colorOpen}<div class="pop on color-pop">
      <div class="pop-title">
        <span>/color</span><span>{t("colorPicker")}</span>
      </div>
      <ColorPicker
        value={composer.command?.arg ?? ""}
        preview={colorPreview}
        nick={chat.identity?.nick ?? ""}
        onpick={pickColor}
        ondone={finishColor}
        onapply={() => {
          chat.submit();
          finishColor();
        }}
      />
    </div>
  {:else if listOpen}<div class="pop on">
      <div class="pop-title">
        <span>{t("complete")}</span><span
          >{composer.selection + 1}/{composer.suggestions.length}</span
        >
      </div>
      <div
        class="completion-options"
        id={`${id}-completions`}
        role="listbox"
        aria-label={t("complete")}
      >
        {#each composer.suggestions as s, i}<button
            id={`${id}-option-${i}`}
            type="button"
            role="option"
            tabindex="-1"
            aria-selected={composer.selection === i}
            class:sel={composer.selection === i}
            onpointerdown={(e) => e.preventDefault()}
            onclick={() => composer.pick(s)}
            ><span class="candidate"
              >{s.slice(0, composer.context?.prefix.length ?? 0)}<strong
                >{s.slice(composer.context?.prefix.length ?? 0)}</strong
              ></span
            >{#if s.startsWith("/")}<span class="candidate-help"
                >{t("cmd_" + s.slice(1))}</span
              >{/if}</button
          >{/each}
      </div>
      <p class="pop-help">{t("completionHint")}</p>
    </div>
  {:else if focused && !composing && help && !composer.dismissed}<div
      class="command-help"
      class:invalid={composer.commandState === "invalid"}
    >
      {help}
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
