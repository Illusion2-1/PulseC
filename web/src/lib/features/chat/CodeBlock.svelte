<script lang="ts">
  import type { Root, RootContent } from "hast";
  import { t } from "#lib/i18n/locale.svelte.ts";

  let { lang, lines }: { lang: string; lines: string[] } = $props();
  const code = $derived(lines.join("\n"));
  const numbers = $derived(lines.map((_, i) => i + 1).join("\n"));
  async function highlight(lang: string, code: string) {
    const syntax = await import("#lib/core/highlight.ts");
    return syntax.highlight(lang, code);
  }
  const highlighted = $derived(highlight(lang, code).catch(() => undefined));

  let copyLabel = $state<"copy" | "copied" | "copyFailed">("copy");
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      copyLabel = "copied";
      setTimeout(() => (copyLabel = "copy"), 1200);
    } catch {
      copyLabel = "copyFailed";
    }
  }
</script>

{#snippet tokens(nodes: RootContent[])}
  {#each nodes as node}{#if node.type === "text"}{node.value}{:else if node.type === "element"}<span
        class={node.properties.className}>{@render tokens(node.children)}</span
      >{/if}{/each}
{/snippet}

{#snippet content(tree?: Root)}
  <span class="bh"
    ><span
      >{lang || tree?.data?.language || "text"} · {t(
        lines.length > 1 ? "lines" : "line",
        { count: lines.length },
      )}</span
    ><button class="cp" onclick={copy}>[{t(copyLabel)}]</button></span
  ><span class="code-lines"
    ><span class="line-numbers" aria-hidden="true">{numbers}</span><span
      >{#if tree}{@render tokens(tree.children)}{:else}{code}{/if}</span
    ></span
  >
{/snippet}

<span class="blk"
  >{#await highlighted}{@render content()}{:then tree}{@render content(
      tree,
    )}{/await}</span
>
