<script>
  import { t } from "./locale.js";
  export let text;
  export let jump;
  let copied = -1,
    failed = -1;
  async function copy(code, i) {
    try {
      await navigator.clipboard.writeText(code);
      failed = -1;
      copied = i;
      setTimeout(() => (copied = -1), 1200);
    } catch {
      failed = i;
    }
  }
  const parts = /(```[\w+-]*\n[\s\S]*?```)/g;
  const tokens =
    /(`[^`\n]+`|https?:\/\/[^\s<>"`]+|>>[a-f0-9]{12}|@[\p{L}\p{N}_-]+)/gu;
</script>

{#each text.split(parts) as part, i}{#if i % 2}
    {@const split = part.indexOf("\n")}
    {@const code = part.slice(split + 1, -3).replace(/\n$/, "")}
    <span class="blk"
      ><span class="bh"
        ><span
          >{part.slice(3, split) || "text"} · {$t(
            code.includes("\n") ? "lines" : "line",
            { count: code.split("\n").length },
          )}</span
        ><button class="cp" on:click={() => copy(code, i)}
          >[{$t(
            failed === i ? "copyFailed" : copied === i ? "copied" : "copy",
          )}]</button
        ></span
      >{#each code.split("\n") as line}<span class="l">{line || " "}</span
        >{/each}</span
    >{:else}{#each part.split("\n") as line, j}{j ? "\n" : ""}<span
        class:q={line.startsWith(">") && !line.startsWith(">>")}
        >{#each line.split(tokens) as t, k}{#if k % 2 === 0}{t}{:else if t.startsWith("http")}<a
              href={t}
              target="_blank"
              rel="noopener noreferrer">{t}</a
            >{:else if t.startsWith(">>")}<button
              class="ref"
              on:click={() => jump(t.slice(2))}>{t}</button
            >{:else if t.startsWith("@")}<span class="at">{t}</span>{:else}<code
              >{t.slice(1, -1)}</code
            >{/if}{/each}</span
      >{/each}{/if}{/each}
