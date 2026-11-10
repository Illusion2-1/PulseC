<script>
  import { t, clock, date } from "./locale.js";
  import { displayEvent, isWarning } from "./messages.js";
  import { clash, mentions, quoteLanes, sameDay, threads } from "./format.js";
  import { colorOf } from "./colors.js";
  import Body from "./Body.svelte";
  export let log,
    below,
    queue,
    current,
    inflight,
    items,
    firstUnread,
    unreadCount,
    identity,
    users,
    jump,
    insert,
    whisper,
    bottom;
  const own = (m) => !!m.trip && m.trip === identity.trip;
  // Trees of consecutive lines, and amber lanes from quoted to quoting rows.
  $: shapes = threads(items, new Set(firstUnread ? [firstUnread] : []));
  $: links = quoteLanes(items);
  // Hovering the left part of a row lights that row; on a tree's first row it
  // lights the whole tree.
  let hot = null;
  const lit = (hot, m, shape) =>
    !!hot && (hot.m === m || (hot.tree && hot.m === shape.root));
  // Colour comes from the live roster when the sender is here, otherwise from
  // the message itself. Rows written by a person also carry a faint stripe.
  $: roster = new Map(users.map((u) => [u.nick + "#" + u.trip, u]));
  // The roster is passed in so the template re-runs when it changes.
  const paint = (m, list) => colorOf(list.get(m.nick + "#" + m.trip) || m);
  const spoken = (m) => !!m.trip && ["chat", "me", "whisper"].includes(m.kind);
</script>

<div
  class="log"
  style:--lanes={links.lanes}
  role="log"
  aria-label={$t("message")}
  bind:this={log}
  on:scroll={() => {
    if (log.scrollHeight - log.scrollTop - log.clientHeight < 40) below = 0;
  }}
>
  {#each items as m, i}
    {@const prev = items[i - 1]}
    {@const time = $clock(m.time)}
    {@const shape = shapes[i]}
    {@const gap = links.gaps[i]}
    {#if !prev || !sameDay(prev.time, m.time)}<div class="div day">
        {#each gap as lane}<i class="lane pass" style:--n={lane}
          ></i>{/each}{$date(m.time)}
      </div>{:else if m.time - prev.time > 300000 && !shape.leaf}<div
        class="div tick"
      >
        {#each gap as lane}<i class="lane pass" style:--n={lane}
          ></i>{/each}{time}
      </div>{/if}
    {#if m === firstUnread}<div class="div">
        {#each gap as lane}<i class="lane pass" style:--n={lane}></i>{/each}{$t(
          "unread",
          { count: unreadCount },
        )}
      </div>{/if}
    <div
      id={m.ref ? "m-" + m.ref : undefined}
      class="ln"
      class:sys={m.kind === "sys" || m.kind === "presence"}
      class:join={m.kind === "presence"}
      class:act={m.kind === "me"}
      class:whis={m.kind === "whisper"}
      class:warn={m.kind === "sys" && isWarning(m)}
      class:who={spoken(m)}
      style:--who={m.trip ? paint(m, roster) : undefined}
      class:leaf={shape.leaf}
      class:root={shape.size > 1}
      class:last={shape.last}
      class:lit={lit(hot, m, shape)}
      class:men={!!m.trip &&
        !own(m) &&
        (m.kind === "whisper" || mentions(m.text, identity.nick))}
      class:self={own(m)}
    >
      {#each links.rows[i] as [lane, kind, cut]}<i
          class={"lane " + kind}
          class:cut
          style:--n={lane}
        ></i>{/each}
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        class="lf"
        on:mouseenter={() => (hot = { m, tree: !shape.leaf })}
        on:mouseleave={() => (hot = null)}
        on:focusin={() => (hot = { m, tree: !shape.leaf })}
        on:focusout={() => (hot = null)}
      >
        <button
          class="tm"
          disabled={!m.ref}
          title={m.ref}
          on:click={() => m.ref && insert(">>" + m.ref + " ")}
          ><span class="hm"
            >{time.slice(0, -3)}<span class="s">{time.slice(-3)}</span></span
          ><span class="id">»{$t("quote")}</span></button
        >{#if shape.leaf}<span></span><span class="br" aria-hidden="true"
          ></span>{:else}<button
            class="tr"
            disabled={!m.trip || !m.nick || own(m)}
            title={m.trip && m.nick && !own(m)
              ? $t("whisperTo", { name: m.nick + "#" + m.trip })
              : m.trip}
            on:click={() => m.trip && m.nick && whisper(m.nick + "#" + m.trip)}
            >{m.trip?.slice(0, 5) || ""}</button
          ><button
            disabled={!m.nick}
            class="nk"
            class:clash={clash(m.nick, m.trip, users)}
            title={m.nick ? $t("mention", { name: m.nick + "#" + m.trip }) : ""}
            on:click={() => m.nick && insert("@" + m.nick + " ")}
            >{m.nick ||
              (m.kind === "presence"
                ? "±"
                : m.kind === "sys" && isWarning(m)
                  ? "!!"
                  : "--")}</button
          >{/if}
      </div>
      <span class="tx"
        >{m.kind === "whisper"
          ? "→ " + m.to + "："
          : m.kind === "me"
            ? "* "
            : ""}<Body
          text={m.kind === "sys" || m.kind === "presence"
            ? displayEvent($t, m)
            : m.text}
          me={identity.nick}
          {jump}
        /></span
      >
    </div>
  {:else}<p class="empty">#{current} · {$t("empty")}</p>{/each}
  {#each queue.filter((q) => q.room === current) as q}<div class="ln pend">
      <div class="lf">
        <span class="tm">…</span><span></span><span class="nk"
          >{$t(q.id === inflight ? "sending" : "queued")}</span
        >
      </div>
      <span class="tx">{q.raw}</span>
    </div>{/each}
  {#if below}<button class="below on" on:click={bottom}
      >↓ {$t(below === 1 ? "newMessage" : "newMessages", {
        count: below,
      })}</button
    >{/if}
</div>
