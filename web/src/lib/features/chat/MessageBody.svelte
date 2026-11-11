<script lang="ts">
  import { parse } from "#lib/core/markup.ts";
  import CodeBlock from "./CodeBlock.svelte";
  import Formula from "./Formula.svelte";

  let {
    text,
    me = "",
    jump,
  }: { text: string; me?: string; jump: (ref: string) => void } = $props();
  const blocks = $derived(parse(text));
</script>

{#each blocks as b}{#if b.kind === "code"}<CodeBlock
      lang={b.lang}
      lines={b.lines}
    />{:else}{#each b.lines as line, j}{j ? "\n" : ""}<span class:q={line.quote}
        >{#each line.tokens as tok}{#if tok.kind === "text"}{tok.text}{:else if tok.kind === "link"}<a
              href={tok.href}
              target="_blank"
              rel="noopener noreferrer">{tok.href}</a
            >{:else if tok.kind === "ref"}<button
              class="ref"
              onclick={() => jump(tok.ref)}>{">>" + tok.ref}</button
            >{:else if tok.kind === "mention"}<span
              class="at"
              class:me={!!me && tok.nick === me}>{"@" + tok.nick}</span
            >{:else if tok.kind === "math"}<Formula
              source={tok.source}
            />{:else}<code>{tok.code}</code>{/if}{/each}</span
      >{/each}{/if}{/each}
