<script lang="ts">
  import { useChat } from "$lib/chat/context";
  import { colorOf } from "$lib/core/colors";
  import { clash, handle } from "$lib/core/identity";
  import { mentions } from "$lib/core/text";
  import { quoteLanes, sameDay, threads, type Shape } from "$lib/core/timeline";
  import { clock, date, t } from "$lib/i18n/locale.svelte";
  import { displayEvent, isWarning } from "$lib/i18n/translate";
  import type { LogEntry } from "$lib/types";
  import MessageBody from "./MessageBody.svelte";
  import QuoteLinks from "./QuoteLinks.svelte";

  const chat = useChat();
  const items = $derived(chat.items);
  const users = $derived(chat.state.users);
  const me = $derived(chat.identity?.nick ?? "");
  // Trees of consecutive lines, and amber lanes from quoted to quoting rows.
  const shapes = $derived(
    threads(items, new Set(chat.firstUnread ? [chat.firstUnread] : [])),
  );
  const links = $derived(quoteLanes(items));
  const pending = $derived(
    chat.outbox.queue.filter((q) => q.room === chat.current),
  );
  // Colour comes from the live roster when the sender is here, otherwise from
  // the message itself. Rows written by a person also carry a faint stripe.
  const roster = $derived(new Map(users.map((u) => [handle(u), u])));

  // Hover or focus on a tree's first row lights the whole tree.
  let hot: { m: LogEntry; tree: boolean } | null = $state.raw(null);
  const lit = (m: LogEntry, shape: Shape) =>
    !!hot && (hot.m === m || (hot.tree && hot.m === shape.root));
  const own = (m: LogEntry) => !!m.trip && m.trip === chat.identity?.trip;
  const spoken = (m: LogEntry) =>
    !!m.trip && (m.kind === "chat" || m.kind === "me" || m.kind === "whisper");
  const pinged = (m: LogEntry) =>
    !!m.trip && !own(m) && (m.kind === "whisper" || mentions(m.text, me));
  const notice = (m: LogEntry) => m.kind === "sys" || m.kind === "presence";
  const author = (m: LogEntry) => !!m.trip && !!m.nick;
</script>

<div
  class="log"
  style:--lanes={links.lanes}
  role="log"
  aria-label={t("message")}
  bind:this={chat.view.log}
  onscroll={() => chat.view.scrolled()}
>
  <QuoteLinks layout={links} />
  {#each items as m, i}
    {@const prev = items[i - 1]}
    {@const time = clock(m.time)}
    {@const shape = shapes[i]}
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
      class:lit={lit(m, shape)}
      class:men={pinged(m)}
      class:self={own(m)}
      onmouseenter={() => (hot = { m, tree: !shape.leaf })}
      onmouseleave={() => (hot = null)}
      onfocusin={() => (hot = { m, tree: !shape.leaf })}
      onfocusout={() => (hot = null)}
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
            class:clash={clash(m.nick, m.trip, users)}
            title={m.nick ? t("mention", { name: handle(m) }) : ""}
            onclick={() => m.nick && chat.composer.insert("@" + m.nick + " ")}
            >{m.nick ||
              (m.kind === "presence"
                ? "±"
                : m.kind === "sys" && isWarning(m)
                  ? "!!"
                  : "--")}</button
          >{/if}
        {#if shape.leaf || shape.size > 1}
          <svg class="tree-branch" aria-hidden="true">
            <line x1="0.5" x2="0.5" y2="100%" />
            {#if shape.leaf}<line class="arm" x1="0.5" x2="100%" />{/if}
          </svg>
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
