<script lang="ts">
  import type { Snippet } from "svelte";
  import "$lib/styles/index.css";

  let { children }: { children: Snippet } = $props();
</script>

{@render children()}
