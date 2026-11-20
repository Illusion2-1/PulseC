<script lang="ts">
  import { useChat } from "#lib/chat/context.ts";
  import { quoteLaneCount, type traceQuotes } from "#lib/core/timeline.ts";

  type Trace = ReturnType<typeof traceQuotes>;
  let {
    activeRow,
    sources,
    replies,
  }: {
    activeRow: number;
    sources: Trace;
    replies: Trace;
  } = $props();
  const chat = useChat();
  let centers = $state.raw<number[]>([]);
  const height = $derived((centers.at(-1) ?? 0) + 4);
  const width = quoteLaneCount * 8;

  // Use the first text line as the terminal even for wrapped rows or late math.
  $effect(() => {
    const log = chat.view.log;
    if (!log) return;
    const update = () => {
      const ys: number[] = [];
      const rows = log.querySelectorAll<HTMLElement>(":scope > [data-row]");
      if (rows.length) {
        const s = getComputedStyle(rows[0]);
        const mid = parseFloat(s.paddingTop) + parseFloat(s.lineHeight) / 2;
        for (const row of rows)
          ys[Number(row.dataset.row)] = Math.floor(row.offsetTop + mid) + 0.5;
      }
      centers = ys;
    };
    const sizes = new ResizeObserver(() => {
      update();
      chat.view.followBottom();
    });
    const watch = (nodes: Iterable<Node>) => {
      for (const n of nodes) if (n instanceof HTMLElement) sizes.observe(n);
    };
    sizes.observe(log);
    watch(log.children);
    const changes = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.removedNodes)
          if (n instanceof HTMLElement) sizes.unobserve(n);
        watch(r.addedNodes);
      }
      update();
    });
    changes.observe(log, { childList: true });
    update();
    return () => {
      sizes.disconnect();
      changes.disconnect();
    };
  });
</script>

{#snippet rail(trace: Trace, side: "sources" | "replies")}
  {#if trace.routes.size && centers.length}
    <svg
      class="quote-trace {side}"
      viewBox={`0 0 ${width} ${height}`}
      {height}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {#each trace.routes.values() as route (route.row)}
        {@const x = 4.5 + route.lane * 8}
        {#if centers[route.first] !== undefined && centers[route.last] !== undefined}
          <g class:direct={route.row === activeRow}>
            <path
              class="stem"
              d={`M${x} ${centers[route.first]}V${centers[route.last]}`}
            />
            <path
              d={[...route.targets]
                .map((i) => `M${x} ${centers[i]}h-4`)
                .join("")}
            />
            <rect
              x={x - 1.5}
              y={centers[route.row] - 1.5}
              width="3"
              height="3"
            />
          </g>
        {/if}
      {/each}
    </svg>
  {/if}
{/snippet}

{@render rail(sources, "sources")}
{@render rail(replies, "replies")}
