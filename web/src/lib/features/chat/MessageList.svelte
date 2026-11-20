<script lang="ts">
  import { useChat } from "#lib/chat/context.ts";
  import { colorOf } from "#lib/core/colors.ts";
  import { clash, handle } from "#lib/core/identity.ts";
  import { mentions } from "#lib/core/text.ts";
  import {
    quoteRelations,
    sameDay,
    threads,
    traceQuotes,
  } from "#lib/core/timeline.ts";
  import { clock, date, t } from "#lib/i18n/locale.svelte.ts";
  import { displayEvent, isWarning } from "#lib/i18n/translate.ts";
  import type { LogEntry } from "#lib/types.ts";
  import MessageBody from "./MessageBody.svelte";
  import QuoteLinks from "./QuoteLinks.svelte";

  const chat = useChat();
  const items = $derived(chat.items);
  const users = $derived(chat.state.users);
  const me = $derived(chat.identity?.nick ?? "");
  const shapes = $derived(
    threads(items, new Set(chat.firstUnread ? [chat.firstUnread] : [])),
  );
  const links = $derived(quoteRelations(items));
  const pending = $derived(
    chat.outbox.queue.filter((q) => q.room === chat.current),
  );
  // Colour comes from the live roster when the sender is here, otherwise from
  // the message itself. Rows written by a person also carry a faint stripe.
  const roster = $derived(new Map(users.map((u) => [handle(u), u])));

  let hovered = $state.raw<LogEntry | null>(null);
  let focused = $state.raw<LogEntry | null>(null);
  let pinned = $state.raw<LogEntry | null>(null);
  const active = $derived(pinned ?? hovered ?? focused);
  const activeRow = $derived(active ? items.indexOf(active) : -1);
  const partners = $derived(links.get(activeRow));
  const sources = $derived(traceQuotes(links, activeRow, "sources", !!pinned));
  const replies = $derived(traceQuotes(links, activeRow, "replies", !!pinned));
  $effect(() => {
    if (pinned && !links.has(items.indexOf(pinned))) pinned = null;
  });

  function release() {
    pinned = hovered = focused = null;
  }

  function toggleTrace(m: LogEntry) {
    if (pinned === m) release();
    else pinned = m;
  }
  const own = (m: LogEntry) => !!m.trip && m.trip === chat.identity?.trip;
  const spoken = (m: LogEntry) =>
    !!m.trip && (m.kind === "chat" || m.kind === "me" || m.kind === "whisper");
  const pinged = (m: LogEntry) =>
    !!m.trip && !own(m) && (m.kind === "whisper" || mentions(m.text, me));
  const notice = (m: LogEntry) => m.kind === "sys" || m.kind === "presence";
  const author = (m: LogEntry) => !!m.trip && !!m.nick;

  const columns = ["tm", "tr", "nk", "tx"] as const;
  let selectedFrom = $state<(typeof columns)[number]>();

  function column(node: Node | null) {
    const el = node instanceof Element ? node : node?.parentElement;
    return columns.findIndex((name) => el?.closest("." + name));
  }

  function updateSelection() {
    const selection = document.getSelection();
    const log = chat.view.log;
    selectedFrom =
      selection &&
      !selection.isCollapsed &&
      log?.contains(selection.anchorNode) &&
      log.contains(selection.focusNode)
        ? columns[
            Math.min(column(selection.anchorNode), column(selection.focusNode))
          ]
        : undefined;
  }
</script>

<svelte:document onselectionchange={updateSelection} />
<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") release();
  }}
/>

<div
  class="log"
  data-select-from={selectedFrom}
  class:has-quotes={links.size > 0}
  role="log"
  aria-label={t("message")}
  bind:this={chat.view.log}
  onscroll={() => chat.view.scrolled()}
>
  <QuoteLinks {activeRow} {sources} {replies} />
  {#each items as m, i (m)}
    {@const prev = items[i - 1]}
    {@const time = clock(m.time)}
    {@const shape = shapes[i]}
    {@const refs = links.get(i)}
    {#if !prev || !sameDay(prev.time, m.time)}<div class="div day">
        {date(m.time)}
      </div>{:else if m.time - prev.time > 300000 && !shape.leaf}<div
        class="div tick"
      >
        {time}
      </div>{/if}
    {#if m === chat.firstUnread}<div class="div">
        {t("unread", {
          count: chat.unreadCount,
        })}
      </div>{/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      id={m.ref ? "m-" + m.ref : undefined}
      class="ln"
      data-row={i}
      class:sys={notice(m)}
      class:join={m.kind === "presence"}
      class:act={m.kind === "me"}
      class:whis={m.kind === "whisper"}
      class:warn={m.kind === "sys" && isWarning(m)}
      class:who={spoken(m)}
      style:--who={m.trip ? colorOf(roster.get(handle(m)) || m) : undefined}
      class:leaf={shape.leaf}
      class:root={shape.size > 1}
      class:last={shape.last}
      class:lit={active === m ||
        (!partners && active === shape.root) ||
        partners?.sources.has(i) ||
        partners?.replies.has(i)}
      class:men={pinged(m)}
      class:self={own(m)}
      onpointerenter={(e) => {
        if (e.pointerType !== "touch") hovered = m;
      }}
      onpointerleave={() => (hovered = null)}
      onfocusin={(e) => {
        if (e.target instanceof Element && e.target.matches(":focus-visible")) {
          hovered = null;
          focused = m;
        }
      }}
      onfocusout={() => (focused = null)}
    >
      <div class="lf">
        <button
          class="tm"
          disabled={!m.ref}
          title={m.ref}
          onclick={() => m.ref && chat.composer.insert(">>" + m.ref + " ")}
          ><span class="hm"
            >{time.slice(0, -3)}<span class="s">{time.slice(-3)}</span></span
          ><span class="id">»{t("quote")}</span></button
        >
        {#if !shape.leaf}<button
            class="tr"
            disabled={!author(m) || own(m)}
            title={author(m) && !own(m)
              ? t("whisperTo", { name: handle(m) })
              : m.trip}
            onclick={() => author(m) && chat.composer.whisper(handle(m))}
            >{m.trip?.slice(0, 5) || ""}</button
          ><button
            disabled={!m.nick}
            class="nk"
            title={m.nick ? t("mention", { name: handle(m) }) : ""}
            onclick={() => m.nick && chat.composer.insert("@" + m.nick + " ")}
            ><span class:clash={clash(m.nick, m.trip, users)}
              >{m.nick ||
                (m.kind === "presence"
                  ? "±"
                  : m.kind === "sys" && isWarning(m)
                    ? "!!"
                    : "--")}</span
            >{#if shape.size > 1}<span class="tree-cap" aria-hidden="true"
              ></span>{/if}</button
          >{/if}
        {#if shape.leaf || shape.size > 1}
          <span class="tree-trunk" aria-hidden="true"></span>
        {/if}
      </div>
      <span class="tx"
        >{m.kind === "whisper"
          ? "→ " + m.to + "："
          : m.kind === "me"
            ? "* "
            : ""}<MessageBody
          text={notice(m) ? displayEvent(t, m) : m.text}
          {me}
          jump={(ref) => chat.jump(ref)}
        /></span
      >
      {#if refs}
        {@const folded = sources.folded.has(i) || replies.folded.has(i)}
        {@const label =
          t("pinQuotes", {
            sources: refs.sources.size,
            replies: refs.replies.size,
          }) + (folded ? " · " + t("foldedQuotes") : "")}
        <button
          class="quote-count"
          aria-label={label}
          title={label}
          aria-pressed={pinned === m}
          onclick={() => toggleTrace(m)}
        >
          {#if refs.sources.size}<span
              class:linked={m === active || partners?.replies.has(i)}
              class:indirect={sources.routes.has(i) || replies.ends.has(i)}
              >↑{refs.sources.size}{sources.folded.has(i) ? "…" : ""}</span
            >{/if}
          {#if refs.replies.size}<span
              class:linked={m === active || partners?.sources.has(i)}
              class:indirect={replies.routes.has(i) || sources.ends.has(i)}
              >↓{refs.replies.size}{replies.folded.has(i) ? "…" : ""}</span
            >{/if}
        </button>
      {/if}
    </div>
  {:else}<p class="empty">#{chat.current} · {t("empty")}</p>{/each}
  {#each pending as q (q.id)}<div class="ln pend">
      <div class="lf">
        <span class="tm">…</span><span></span><span class="nk"
          >{t(q.id === chat.outbox.inflight ? "sending" : "queued")}</span
        >
      </div>
      <span class="tx">{q.raw}</span>
    </div>{/each}
  {#if chat.view.below}<button
      class="below on"
      onclick={() => chat.view.bottom()}
      >↓ {t(chat.view.below === 1 ? "newMessage" : "newMessages", {
        count: chat.view.below,
      })}</button
    >{/if}
</div>
