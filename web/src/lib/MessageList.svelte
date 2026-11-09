<script>
  import { t, clock } from "./locale.js";
  import { displayEvent } from "./messages.js";
  import { color, clash } from "./format.js";
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
    bottom;
</script>

<div
  class="log"
  role="log"
  aria-label={$t("message")}
  bind:this={log}
  on:scroll={() => {
    if (log.scrollHeight - log.scrollTop - log.clientHeight < 40) below = 0;
  }}
>
  {#each items as m, i}
    {@const prev = items[i - 1]}
    {#if m === firstUnread}<div class="div">
        {$t("unread", { count: unreadCount })}
      </div>{/if}
    {#if !prev || m.time - prev.time > 300000}<div class="div tick">
        {$clock(m.time)}
      </div>{/if}
    <div
      id={m.ref ? "m-" + m.ref : undefined}
      class="ln"
      class:sys={m.kind === "sys" || m.kind === "presence"}
      class:join={m.kind === "presence"}
      class:act={m.kind === "me"}
      class:whis={m.kind === "whisper"}
      class:cont={prev &&
        m.kind === "chat" &&
        prev.kind === "chat" &&
        prev.trip === m.trip &&
        prev.nick === m.nick &&
        m.time - prev.time < 120000}
      class:men={m.trip !== identity.trip &&
        (m.kind === "whisper" || m.text.includes("@" + identity.nick))}
      class:self={m.trip === identity.trip}
    >
      <button
        class="tm"
        disabled={!m.ref}
        title={m.ref}
        on:click={() => m.ref && insert(">>" + m.ref + " ")}
        ><span class="hm">{$clock(m.time)}</span><span class="id"
          >»{$t("quote")}</span
        ></button
      >
      <button
        class="tr"
        disabled={!m.ref}
        title={m.trip}
        on:click={() => m.ref && insert(">>" + m.ref + " ")}
        >{m.trip?.slice(0, 5) || ""}</button
      >
      <button
        disabled={!m.nick}
        class={"nk " + (m.trip ? color(m.trip) : "")}
        class:clash={clash(m.nick, m.trip, users)}
        title={m.nick ? m.nick + "#" + m.trip : ""}
        on:click={() => m.nick && insert("@" + m.nick + " ")}
        >{m.nick || (m.kind === "presence" ? "±" : "--")}</button
      >
      <span class="tx"
        >{m.kind === "whisper"
          ? "→ " + m.to + "："
          : m.kind === "me"
            ? "* "
            : ""}<Body
          text={m.kind === "sys" || m.kind === "presence"
            ? displayEvent($t, m)
            : m.text}
          {jump}
        /></span
      >
    </div>
  {:else}<p class="empty">#{current} · {$t("empty")}</p>{/each}
  {#each queue.filter((q) => q.room === current) as q}<div class="ln pend">
      <span class="tm">…</span><span></span><span class="nk"
        >{$t(q.id === inflight ? "sending" : "queued")}</span
      ><span class="tx">{q.raw}</span>
    </div>{/each}
  {#if below}<button class="below on" on:click={bottom}
      >↓ {$t(below === 1 ? "newMessage" : "newMessages", {
        count: below,
      })}</button
    >{/if}
</div>
