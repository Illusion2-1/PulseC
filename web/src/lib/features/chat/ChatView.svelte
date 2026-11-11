<script lang="ts">
  import { useChat } from "#lib/chat/context.ts";
  import { t } from "#lib/i18n/locale.svelte.ts";
  import TopBar from "#lib/ui/TopBar.svelte";
  import ChannelTabs from "./ChannelTabs.svelte";
  import Composer from "./Composer.svelte";
  import MemberList from "./MemberList.svelte";
  import MessageList from "./MessageList.svelte";
  import StatusBar from "./StatusBar.svelte";

  const chat = useChat();

  function hotkey(e: KeyboardEvent) {
    if (e.key === "Escape" && chat.view.membersOpen) {
      chat.view.closeMembers();
      return;
    }
    if (e.altKey && /^[1-9]$/.test(e.key)) {
      const name = [...chat.rooms.keys()][Number(e.key) - 1];
      if (name) {
        e.preventDefault();
        chat.select(name);
      }
    }
  }
</script>

<svelte:window onkeydown={hotkey} />
<main class="app" class:show-users={chat.view.membersOpen}>
  <TopBar now={chat.now}>
    {#snippet brand()}<button
        class="brand"
        onclick={() => chat.leave(true)}
        title={t("leave")}>PulseC</button
      >{/snippet}
    {#snippet title()}<span class="ch">#{chat.current}</span> · {chat.state
        .topic || t("noTopic")}{/snippet}
  </TopBar>
  <ChannelTabs />
  <MessageList />
  <MemberList />
  <StatusBar />
  <Composer />
</main>
