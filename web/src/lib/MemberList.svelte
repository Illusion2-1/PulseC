<script>
  import { t, language } from "./locale.js";
  import { clash } from "./format.js";
  import { colorOf } from "./colors.js";
  export let users,
    state,
    admin,
    moderate,
    identity,
    now,
    insert,
    whisper,
    close;
  let menu = "";
  $: owner = state.owner || "";
  $: mods = state.mods || [];
  $: muted = state.muted || [];
  $: banned = state.banned || [];
  $: managed = "owner" in state;
  const role = (trip) =>
    trip === owner ? "@" : mods.includes(trip) ? "+" : "";
  // Admins act on others; only the creator acts on moderators.
  $: canManage = (u) =>
    admin &&
    u.trip !== identity.trip &&
    u.trip !== owner &&
    (!mods.includes(u.trip) || identity.trip === owner);
  function act(action, u) {
    if (
      action === "ban" &&
      !window.confirm($t("banConfirm", { name: u.nick + "#" + u.trip }))
    )
      return;
    moderate(action, { target: u.trip });
    menu = "";
  }
  // Checkboxes show the relay's state; a click only sends the request.
  function toggle(e, action) {
    const on = e.currentTarget.checked;
    e.currentTarget.checked = !on;
    moderate(action, { on });
  }
</script>

<aside class="users" id="members" aria-label={$t("online")}>
  <h3>{$t("online")} <span>{users.length}</span></h3>
  {#each [false, true] as idle}{@const group = users
      .filter((u) => now / 1000 - u.active >= 600 === idle)
      .sort((a, b) => a.nick.localeCompare(b.nick, $language))}
    {#if group.length}<div class="grp">
        {$t(idle ? "idle" : "active")}
        {group.length}
      </div>{/if}
    {#each group as u (u.id)}{@const me =
        u.trip === identity.trip && u.nick === identity.nick}{@const r = role(
        u.trip,
      )}{@const silenced = muted.includes(u.trip)}
      <div
        class="u"
        class:idle
        class:me
        class:muted={silenced}
        title={u.nick +
          "#" +
          u.trip +
          (r ? " · " + $t(r === "@" ? "owner" : "moderator") : "") +
          (silenced ? " · " + $t("mutedTag") : "")}
      >
        <span class="r">{r}</span><button
          class="nm"
          style:--who={colorOf(u)}
          class:clash={clash(u.nick, u.trip, users)}
          aria-label={$t("mention", { name: u.nick + "#" + u.trip })}
          on:click={() => {
            insert("@" + u.nick + " ");
            close();
          }}>{u.nick}</button
        ><button
          class="tr"
          disabled={me}
          aria-label={me
            ? u.nick + "#" + u.trip
            : $t("whisperTo", { name: u.nick + "#" + u.trip })}
          on:click={() => {
            whisper(u.nick + "#" + u.trip);
            close();
          }}>{u.trip.slice(0, 5)}</button
        >{#if canManage(u)}<button
            class="more"
            aria-expanded={menu === u.trip}
            aria-label={$t("manage", { name: u.nick + "#" + u.trip })}
            on:click={() => (menu = menu === u.trip ? "" : u.trip)}>⋯</button
          >{/if}
      </div>
      {#if menu === u.trip && canManage(u)}<div class="acts">
          <button on:click={() => act("kick", u)}>{$t("kick")}</button>
          <button class="danger" on:click={() => act("ban", u)}
            >{$t("ban")}</button
          >
          <button on:click={() => act(silenced ? "unmute" : "mute", u)}
            >{$t(silenced ? "unmute" : "mute")}</button
          >
          {#if identity.trip === owner}<button
              on:click={() => act(r === "+" ? "deop" : "op", u)}
              >{$t(r === "+" ? "deop" : "op")}</button
            >{/if}
        </div>{/if}{/each}{/each}
  {#if managed}<section class="opts" aria-label={$t("settings")}>
      <h3>{$t("settings")}</h3>
      {#if !owner}<p class="dim">{$t("noAdmin")}</p>{:else}
        <label
          ><span>{$t("slowLabel")}</span><select
            class="language"
            disabled={!admin}
            value={state.slow || 0}
            on:change={(e) => {
              const rate = Number(e.currentTarget.value);
              e.currentTarget.value = String(state.slow || 0);
              moderate("slow", { rate, on: rate > 0 });
            }}
            >{#each [0, 1, 2, 3, 4, 5] as n}<option value={n}
                >{n ? $t("slowRate", { count: n }) : $t("slowOff")}</option
              >{/each}</select
          ></label
        >
        <label
          ><input
            type="checkbox"
            disabled={!admin}
            checked={!!state.locked}
            on:change={(e) => toggle(e, "lock")}
          />{$t("lockLabel")}</label
        >
        <label
          ><input
            type="checkbox"
            disabled={!admin}
            checked={!!state.topicLocked}
            on:change={(e) => toggle(e, "topiclock")}
          />{$t("topicLockLabel")}</label
        >
        <label
          ><input
            type="checkbox"
            disabled={!admin}
            checked={!!state.public}
            on:change={(e) => toggle(e, "public")}
          />{$t("publicLabel")}</label
        >
        {#if banned.length}<div class="grp">
            {$t("bannedList")}
            {banned.length}
          </div>
          {#each banned as trip (trip)}<div class="b">
              <span class="nm" title={trip}>#{trip.slice(0, 8)}</span
              >{#if admin}<button
                  class="un"
                  on:click={() => moderate("unban", { target: trip })}
                  >{$t("unban")}</button
                >{/if}
            </div>{/each}{/if}
      {/if}
    </section>{/if}
  <button class="utog" on:click={() => close()}>{$t("close")}</button>
</aside>
