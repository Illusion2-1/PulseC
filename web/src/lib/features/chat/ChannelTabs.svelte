<script lang="ts">
  import { useChat } from "#lib/chat/context.ts";
  import { t } from "#lib/i18n/locale.svelte.ts";

  const chat = useChat();
</script>

<nav class="tabs" aria-label={t("channel")}>
  {#each chat.rooms.values() as r, i (r.name)}<button
      class="tab"
      class:act={r.name === chat.current}
      aria-current={r.name === chat.current ? "page" : undefined}
      class:men={r.mentioned}
      class:unr={r.name !== chat.current && r.unread > 0}
      class:gone={r.parted}
      onclick={() => chat.select(r.name)}
      >{i + 1}:{r.name}{r.name === chat.current
        ? "*"
        : r.unread
          ? (r.mentioned ? "!" : "+") + r.unread
          : ""}</button
    >{/each}<button class="add" onclick={() => chat.composer.insert("/join ")}
    >/join</button
  >
</nav>
