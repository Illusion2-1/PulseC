<script>
  import { t, language } from "./locale.js";
  import { color, clash } from "./format.js";
  export let users, identity, now, insert, whisper, close;
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
    {#each group as u}{@const me =
        u.trip === identity.trip && u.nick === identity.nick}
      <div class="u" class:idle class:me title={u.nick + "#" + u.trip}>
        <button
          class={"nm " + color(u.trip)}
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
          }}>{me ? $t("you") : u.trip.slice(0, 5)}</button
        >
      </div>{/each}{/each}
  <button class="utog" on:click={() => close()}>{$t("close")}</button>
</aside>
