<script lang="ts">
  import { useChat } from "$lib/chat/context";
  import { colorOf } from "$lib/core/colors";
  import { clash, handle } from "$lib/core/identity";
  import { canManage, idle as isIdle, roleOf } from "$lib/core/roster";
  import { locale, t } from "$lib/i18n/locale.svelte";
  import type { Member, ModerationAction } from "$lib/types";

  const chat = useChat();
  const room = $derived(chat.state);
  const users = $derived(room.users);
  const self = $derived(chat.identity?.trip ?? "");
  const owner = $derived(room.owner || "");
  const muted = $derived(room.muted || []);
  const banned = $derived(room.banned || []);
  const managed = $derived("owner" in room);
  let menu = $state("");

  const groups = $derived(
    [false, true].map((idle) => ({
      idle,
      users: users
        .filter((u) => isIdle(u, chat.now) === idle)
        .sort((a, b) => a.nick.localeCompare(b.nick, locale.language)),
    })),
  );

  function act(action: ModerationAction, u: Member) {
    if (action === "ban" && !chat.confirm("banConfirm", { name: handle(u) }))
      return;
    chat.moderate(action, { target: u.trip });
    menu = "";
  }
  // Checkboxes show the relay's state; a click only sends the request.
  function toggle(e: Event, action: ModerationAction) {
    const box = e.currentTarget as HTMLInputElement;
    const on = box.checked;
    box.checked = !on;
    chat.moderate(action, { on });
  }
  function slow(e: Event) {
    const select = e.currentTarget as HTMLSelectElement;
    const rate = Number(select.value);
    select.value = String(room.slow || 0);
    chat.moderate("slow", { rate, on: rate > 0 });
  }
  function mention(u: Member) {
    chat.composer.insert("@" + u.nick + " ");
    chat.view.closeMembers();
  }
  function whisper(u: Member) {
    chat.composer.whisper(handle(u));
    chat.view.closeMembers();
  }
</script>

<aside class="users" id="members" aria-label={t("online")}>
  <h3>{t("online")} <span>{users.length}</span></h3>
  {#each groups as { idle, users: group } (idle)}
    {#if group.length}<div class="grp">
        {t(idle ? "idle" : "active")}
        {group.length}
      </div>{/if}
    {#each group as u (u.id)}{@const me =
        u.trip === self && u.nick === chat.identity?.nick}{@const r = roleOf(
        room,
        u.trip,
      )}{@const silenced = muted.includes(u.trip)}{@const manage = canManage(
        room,
        self,
        u.trip,
      )}
      <div
        class="u"
        class:idle
        class:me
        class:muted={silenced}
        title={handle(u) +
          (r ? " · " + t(r === "@" ? "owner" : "moderator") : "") +
          (silenced ? " · " + t("mutedTag") : "")}
      >
        <span class="r">{r}</span><button
          class="nm"
          style:--who={colorOf(u)}
          class:clash={clash(u.nick, u.trip, users)}
          aria-label={t("mention", { name: handle(u) })}
          onclick={() => mention(u)}>{u.nick}</button
        ><button
          class="tr"
          disabled={me}
          aria-label={me ? handle(u) : t("whisperTo", { name: handle(u) })}
          onclick={() => whisper(u)}>{u.trip.slice(0, 5)}</button
        >{#if manage}<button
            class="more"
            aria-expanded={menu === u.trip}
            aria-label={t("manage", { name: handle(u) })}
            onclick={() => (menu = menu === u.trip ? "" : u.trip)}>⋯</button
          >{/if}
      </div>
      {#if menu === u.trip && manage}<div class="acts">
          <button onclick={() => act("kick", u)}>{t("kick")}</button>
          <button class="danger" onclick={() => act("ban", u)}
            >{t("ban")}</button
          >
          <button onclick={() => act(silenced ? "unmute" : "mute", u)}
            >{t(silenced ? "unmute" : "mute")}</button
          >
          {#if self === owner}<button
              onclick={() => act(r === "+" ? "deop" : "op", u)}
              >{t(r === "+" ? "deop" : "op")}</button
            >{/if}
        </div>{/if}{/each}{/each}
  {#if managed}<section class="opts" aria-label={t("settings")}>
      <h3>{t("settings")}</h3>
      {#if !owner}<p class="dim">{t("noAdmin")}</p>{:else}
        <label
          ><span>{t("slowLabel")}</span><select
            class="language"
            disabled={!chat.admin}
            value={room.slow || 0}
            onchange={slow}
            >{#each [0, 1, 2, 3, 4, 5] as n}<option value={n}
                >{n ? t("slowRate", { count: n }) : t("slowOff")}</option
              >{/each}</select
          ></label
        >
        <label
          ><input
            type="checkbox"
            disabled={!chat.admin}
            checked={!!room.locked}
            onchange={(e) => toggle(e, "lock")}
          />{t("lockLabel")}</label
        >
        <label
          ><input
            type="checkbox"
            disabled={!chat.admin}
            checked={!!room.topicLocked}
            onchange={(e) => toggle(e, "topiclock")}
          />{t("topicLockLabel")}</label
        >
        <label
          ><input
            type="checkbox"
            disabled={!chat.admin}
            checked={!!room.public}
            onchange={(e) => toggle(e, "public")}
          />{t("publicLabel")}</label
        >
        {#if banned.length}<div class="grp">
            {t("bannedList")}
            {banned.length}
          </div>
          {#each banned as trip (trip)}<div class="b">
              <span class="nm" title={trip}>#{trip.slice(0, 8)}</span
              >{#if chat.admin}<button
                  class="un"
                  onclick={() => chat.moderate("unban", { target: trip })}
                  >{t("unban")}</button
                >{/if}
            </div>{/each}{/if}
      {/if}
    </section>{/if}
  <button class="utog" onclick={() => chat.view.closeMembers()}
    >{t("close")}</button
  >
</aside>
