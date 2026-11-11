<script lang="ts">
  import type { Snippet } from "svelte";
  import { useChat } from "#lib/chat/context.ts";
  import { clock } from "#lib/i18n/locale.svelte.ts";
  import LanguagePicker from "./LanguagePicker.svelte";

  // The one-line header shared by the entrance and the chat screen.
  let { brand, title, now }: { brand: Snippet; title: Snippet; now: number } =
    $props();
  const chat = useChat();
</script>

<header class="bar head">
  {@render brand()}<span class="grow">{@render title()}</span>
  {#if chat.connection}<span class="wide"
      >{chat.connection.transport} · {chat.connection.encryption}</span
    >{/if}<LanguagePicker /><time>{clock(now)}</time>
</header>
