<script lang="ts">
  import type { Snippet } from "svelte";
  import { clock } from "$lib/i18n/locale.svelte";
  import LanguagePicker from "./LanguagePicker.svelte";

  // The one-line header shared by the entrance and the chat screen.
  let { brand, title, now }: { brand: Snippet; title: Snippet; now: number } =
    $props();
</script>

<header class="bar head">
  {@render brand()}<span class="grow">{@render title()}</span><span class="wide"
    >WebTransport · TLS 1.3</span
  ><LanguagePicker /><time>{clock(now)}</time>
</header>
