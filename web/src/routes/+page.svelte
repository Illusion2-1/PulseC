<script lang="ts">
  import { onMount } from "svelte";
  import { browserDeps, ChatClient } from "$lib/chat/client.svelte";
  import { provideChat } from "$lib/chat/context";
  import ChatView from "$lib/features/chat/ChatView.svelte";
  import Entrance from "$lib/features/entrance/Entrance.svelte";
  import { locale, t } from "$lib/i18n/locale.svelte";

  const chat = provideChat(new ChatClient(browserDeps()));
  locale.load();
  chat.restore();
  chat.visibility(document.hidden);
  onMount(() => chat.start());

  const badge = $derived(
    chat.pending ? "(" + (chat.pinged ? "!" : "") + chat.pending + ") " : "",
  );
</script>

<svelte:head
  ><title
    >{chat.current
      ? badge + "#" + chat.current + " · PulseC"
      : "PulseC · " + t("join")}</title
  ></svelte:head
>
<svelte:document onvisibilitychange={() => chat.visibility(document.hidden)} />
{#if chat.current}<ChatView />{:else}<Entrance />{/if}
