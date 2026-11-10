<script lang="ts">
  import { useChat } from "$lib/chat/context";
  import { lanePath, type Lanes } from "$lib/core/timeline";

  let { layout }: { layout: Lanes } = $props();
  const chat = useChat();
  let svg: SVGSVGElement | undefined = $state();
  let d = $state("");
  let height = $state(0);

  // Centre 1px strokes on a pixel so they stay sharp.
  const snap = (v: number) => Math.round(v - 0.5) + 0.5;

  // Reads row positions from the log. Rows are its children marked data-row;
  // the gutter is the svg itself, (lanes + 2) characters wide less 2px.
  function measure(log: HTMLElement, svg: SVGSVGElement, layout: Lanes) {
    const ys: number[] = [];
    let mid = 0,
      bottom = 0;
    for (const el of log.querySelectorAll<HTMLElement>(":scope > [data-row]")) {
      if (!mid) {
        const s = getComputedStyle(el);
        mid = parseFloat(s.paddingTop) + parseFloat(s.lineHeight) / 2;
      }
      const y = snap(el.offsetTop + mid - 0.5);
      ys[Number(el.dataset.row)] = y;
      bottom = Math.max(bottom, y + 1);
    }
    const tip = svg.getBoundingClientRect().width,
      ch = (tip + 2) / (layout.lanes + 2);
    d = lanePath(layout, {
      x: (lane) => snap((layout.lanes - lane + 0.5) * ch),
      tip,
      y: (row) => ys[row],
      hop: Math.min(3, ch / 3),
    });
    height = bottom;
  }

  // Re-measure when the layout changes, when any row changes size (wrapping,
  // fonts, window width) and when rows or dividers are added or removed.
  $effect(() => {
    const log = chat.view.log,
      el = svg;
    if (!log || !el) return;
    const update = () => measure(log, el, layout);
    update();
    const sizes = new ResizeObserver(update);
    const watch = (nodes: Iterable<Node>) => {
      for (const n of nodes) if (n instanceof HTMLElement) sizes.observe(n);
    };
    watch(log.children);
    const rows = new MutationObserver((records) => {
      for (const r of records) watch(r.addedNodes);
      update();
    });
    rows.observe(log, { childList: true });
    return () => {
      sizes.disconnect();
      rows.disconnect();
    };
  });
</script>

<svg class="links" bind:this={svg} {height} aria-hidden="true"><path {d} /></svg
>
