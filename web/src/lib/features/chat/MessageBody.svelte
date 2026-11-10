<script lang="ts">
  import { parse } from "$lib/core/markup";
  import { t } from "$lib/i18n/locale.svelte";

  let {
    text,
    me = "",
    jump,
  }: { text: string; me?: string; jump: (ref: string) => void } = $props();
  const blocks = $derived(parse(text));
  let copied = $state(-1),
    failed = $state(-1);
  async function copy(code: string, i: number) {
    try {
      await navigator.clipboard.writeText(code);
      failed = -1;
      copied = i;
      setTimeout(() => (copied = -1), 1200);
    } catch {
      failed = i;
    }
  }
</script>

{#each blocks as b, i}{#if b.kind === "code"}<span class="blk"
      ><span class="bh"
        ><span
          >{b.lang} · {t(b.lines.length > 1 ? "lines" : "line", {
            count: b.lines.length,
          })}</span
        ><button class="cp" onclick={() => copy(b.lines.join("\n"), i)}
          >[{t(
            failed === i ? "copyFailed" : copied === i ? "copied" : "copy",
          )}]</button
        ></span
      >{#each b.lines as line}<span class="l">{line || " "}</span>{/each}</span
    >{:else}{#each b.lines as line, j}{j ? "\n" : ""}<span class:q={line.quote}
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
            >{:else}<code>{tok.code}</code>{/if}{/each}</span
      >{/each}{/if}{/each}
