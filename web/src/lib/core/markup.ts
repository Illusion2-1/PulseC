// Chat markup is scanned left to right so code, links and formulas keep their
// contents literal. Display math can contain newlines and alignment markers.
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "link"; href: string }
  | { kind: "ref"; ref: string }
  | { kind: "mention"; nick: string }
  | { kind: "code"; code: string }
  | { kind: "math"; source: string };

export interface Line {
  /** A "> " quote line. ">>ref" lines are not quotes. */
  quote: boolean;
  tokens: Inline[];
}

export type Block =
  | { kind: "code"; lang: string; lines: string[] }
  | { kind: "prose"; lines: Line[] };

export const messageMarks = new RegExp(
  [
    /```[\w+#-]*\n[\s\S]*?```/,
    /`[^`\n]+`/,
    /https?:\/\/[^\s<>"`]+/,
    /(?<!\\)\$\$(?:\\[\s\S]|[^\\$]|\$(?!\$))*\$\$/,
    // Tight dollar delimiters distinguish inline math from prices like "$5 and $10".
    /(?<![\\$])\$(?![\s$])(?:\\[^\n]|[^\\$\n])*(?<!\s)\$(?![\w$])/,
    /(?<!\\)\\\[(?:[^\\]|\\(?!\])[\s\S])*\\\]/,
    /(?<!\\)\\\((?:[^\\\n]|\\(?!\))[^\n])*\\\)/,
    />>[a-f0-9]{12}|@[\p{L}\p{N}_-]+|\n/u,
  ]
    .map((pattern) => pattern.source)
    .join("|"),
  "gu",
);

function inline(mark: string): Inline {
  if (mark.startsWith("http")) return { kind: "link", href: mark };
  if (mark.startsWith(">>")) return { kind: "ref", ref: mark.slice(2) };
  if (mark.startsWith("@")) return { kind: "mention", nick: mark.slice(1) };
  if (mark.startsWith("`")) return { kind: "code", code: mark.slice(1, -1) };
  return { kind: "math", source: mark };
}

export function parse(text: string): Block[] {
  const blocks: Block[] = [];
  let lines: Line[] = [];
  function startLine(at: number) {
    const tokens: Inline[] = [];
    lines.push({ quote: text[at] === ">" && text[at + 1] !== ">", tokens });
    return tokens;
  }
  let end = 0;
  let tokens = startLine(0);
  for (const { 0: mark, index } of text.matchAll(messageMarks)) {
    if (index > end)
      tokens.push({ kind: "text", text: text.slice(end, index) });
    end = index + mark.length;
    if (mark.startsWith("```")) {
      const split = mark.indexOf("\n");
      blocks.push(
        { kind: "prose", lines },
        {
          kind: "code",
          lang: mark.slice(3, split),
          lines: mark
            .slice(split + 1, -3)
            .replace(/\n$/, "")
            .split("\n"),
        },
      );
      lines = [];
      tokens = startLine(end);
    } else if (mark === "\n") {
      tokens = startLine(end);
    } else {
      tokens.push(inline(mark));
    }
  }
  if (end < text.length) tokens.push({ kind: "text", text: text.slice(end) });
  blocks.push({ kind: "prose", lines });
  return blocks;
}
