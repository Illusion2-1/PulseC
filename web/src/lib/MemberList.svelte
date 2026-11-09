<script>
  import { t, language } from "./locale.js";
  import { color, clash } from "./format.js";
  export let users, identity, now, insert, close;
</script>

<aside class="users" id="members" aria-label={$t("online")}>
  <h3>{$t("online")} <span>{users.length}</span></h3>
  {#each [false, true] as idle}{@const group = users
      .filter((u) => now / 1000 - u.active >= 600 === idle)
      .sort((a, b) => a.nick.localeCompare(b.nick))}
    {#if group.length}<div class="grp">
        {$t(idle ? "idle" : "active")}
        {group.length}
      </div>{/if}
    {#each group as u}<button
        class="u"
        class:idle
        class:me={u.trip === identity.trip && u.nick === identity.nick}
        title={u.nick + "#" + u.trip}
        on:click={() => {
          insert("@" + u.nick + " ");
          close();
        }}
        ><span
          class={"nm " + color(u.trip)}
          class:clash={clash(u.nick, u.trip, users)}>{u.nick}</span
        ><span class="tr">{u.trip}</span></button
      >{/each}{/each}
  <button class="utog" on:click={() => close()}>{$t("close")}</button>
</aside>
