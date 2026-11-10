<script lang="ts">
  import { useChat } from "$lib/chat/context";
  import { averageRate, spark } from "$lib/core/text";
  import { t } from "$lib/i18n/locale.svelte";

  const chat = useChat();
  const users = $derived(chat.state.users);
  const pulse = $derived(chat.state.pulse);
</script>

<div class="bar stat" class:off={chat.status !== "connected"}>
  <span
    role="status"
    title={chat.status === "reconnecting" ? t("offlineHint") : undefined}
    >{t(chat.status)}</span
  ><span class="wide"
    ><span class="k">{t("onlineLabel")}</span> {users.length}</span
  ><button
    class="utog"
    aria-expanded={chat.view.membersOpen}
    aria-controls="members"
    bind:this={chat.view.membersToggle}
    onclick={() => chat.view.toggleMembers()}
    >{t("members", { count: users.length })}</button
  ><span title={t("pulse")}
    ><span class="k wide">{t("pulseLabel")}</span>
    <span class="pulse">{spark(pulse)}</span>
    <span class="wide">{t("perMinute", { rate: averageRate(pulse) })}</span
    ></span
  ><span class="grow"
    >{#if chat.cacheError}<span class="warnText">{t(chat.cacheError)}</span
      >{:else}<span class="k">{t("records")}</span>
      {chat.room?.total ?? 0}{/if}</span
  ><span class="rtt"
    ><span class="k">rtt</span>
    {chat.rtt === null ? "—" : chat.rtt + " ms"}</span
  >
  {#if chat.status === "reconnecting"}<span class="offline-detail"
      >{t("offlineHint")}</span
    >{/if}
</div>
