<script lang="ts">
  let { source }: { source: string } = $props();
  const display = $derived(source.startsWith("$$") || source.startsWith("\\["));
  const inset = $derived(!display && source.startsWith("$") ? 1 : 2);
  const renderer = Promise.all([
    import("katex"),
    import("katex/dist/katex.min.css"),
  ]);
</script>

<span class="formula" class:display
  >{#await renderer}{source}{:then [katex]}<span
      {@attach (node) => {
        katex.render(source.slice(inset, -inset), node, {
          displayMode: display,
          throwOnError: false,
          errorColor: "var(--red)",
          maxSize: 20,
          trust: false,
        });
      }}
    ></span>{:catch}{source}{/await}</span
>

<style>
  .formula {
    white-space: normal;
    overflow-wrap: normal;
    font-style: normal;
  }
  .formula:not(.display) {
    display: inline-block;
    max-width: 100%;
    overflow-x: auto;
    vertical-align: middle;
  }
  .display {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    padding: 1.05em 0.5ch;
    margin: 2px 0;
    background: var(--bg-1);
    font-size: 1.08em;
  }
  .display :global(.katex-display) {
    width: max-content;
    min-width: 100%;
    margin: 0;
  }
</style>
