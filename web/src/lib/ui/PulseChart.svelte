<script lang="ts">
  import { averageRate, pulseHeights } from "$lib/core/text";
  import { t } from "$lib/i18n/locale.svelte";

  let { buckets }: { buckets: number[] } = $props();
  const heights = $derived(pulseHeights(buckets));
</script>

{#if heights.length}
  <svg
    class="pulse"
    role="img"
    aria-label={t("pulseSummary", {
      minutes: buckets.length,
      rate: averageRate(buckets),
    })}
    width="{heights.length}ch"
    height="1em"
    viewBox="0 0 {heights.length * 4} 8"
    preserveAspectRatio="none"
    fill="currentColor"
  >
    {#each heights as height, i}
      <rect x={4 * i} y={8 - height} width="3" {height} />
    {/each}
  </svg>
{/if}
