<script lang="ts">
  import { useChat } from "#lib/chat/context.ts";
  import { t } from "#lib/i18n/locale.svelte.ts";
  import type { DirectoryRoom } from "#lib/types.ts";
  import PulseChart from "#lib/ui/PulseChart.svelte";

  let {
    target,
    onchoose,
  }: { target: string; onchoose: (name: string) => void } = $props();
  const chat = useChat();
  const listed = $derived(chat.directory.filter((r) => r.public));
  const find = (name: string) => chat.directory.find((r) => r.name === name);
</script>

{#snippet row(name: string, r: DirectoryRoom | undefined)}
  <button
    class="c"
    class:sel={name === target}
    aria-current={name === target ? "true" : undefined}
    title={r?.topic ? "#" + name + " · " + r.topic : "#" + name}
    onclick={() => onchoose(name)}
    ><span class="cn"
      >#{name}{#if r?.locked}<span class="lk">
          · {t("lockedRoom")}</span
        >{/if}</span
    >{#if r}<PulseChart buckets={r.pulse.slice(-10)} />{/if}<span class="co"
      >{chat.foundDirectory ? r?.online || 0 : "—"}</span
    >{#if r?.topic}<span class="ct">{r.topic}</span>{/if}</button
  >
{/snippet}

<aside class="users" aria-label={t("channel")}>
  <h3>{t("publicRooms")} <span>{listed.length}</span></h3>
  {#each listed as r (r.name)}{@render row(r.name, r)}{:else}<p class="empty">
      {chat.foundDirectory ? t("noPublic") : t(chat.status)}
    </p>{/each}
  <h3>{t("knownRooms")} <span>{chat.known.length}</span></h3>
  {#each chat.known as n (n)}{@render row(n, find(n))}{:else}<p class="empty">
      {t("noKnown")}
    </p>{/each}
</aside>
