// Message text is plain text with a few marks: fenced code blocks, inline
// `code`, links, >>ref quotes, @mentions and "> " quote lines. Parsing happens
// here so components only render tokens; nothing is ever inserted as HTML.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "link"; href: string }
  | { kind: "ref"; ref: string }
  | { kind: "mention"; nick: string }
  | { kind: "code"; code: string };

export interface Line {
  /** A "> " quote line. ">>ref" lines are not quotes. */
  quote: boolean;
  tokens: Inline[];
}

export type Block =
  | { kind: "code"; lang: string; lines: string[] }
  | { kind: "prose"; lines: Line[] };

const fences = /(```[\w+-]*\n[\s\S]*?```)/g;
const marks =
  /(`[^`\n]+`|https?:\/\/[^\s<>"`]+|>>[a-f0-9]{12}|@[\p{L}\p{N}_-]+)/gu;

function inline(mark: string): Inline {
  if (mark.startsWith("http")) return { kind: "link", href: mark };
  if (mark.startsWith(">>")) return { kind: "ref", ref: mark.slice(2) };
  if (mark.startsWith("@")) return { kind: "mention", nick: mark.slice(1) };
  return { kind: "code", code: mark.slice(1, -1) };
}

export function parse(text: string): Block[] {
  return text.split(fences).map((part, i): Block => {
    if (i % 2) {
      const split = part.indexOf("\n");
      const code = part.slice(split + 1, -3).replace(/\n$/, "");
      return {
        kind: "code",
        lang: part.slice(3, split) || "text",
        lines: code.split("\n"),
      };
    }
    return {
      kind: "prose",
      lines: part.split("\n").map((line) => ({
        quote: line.startsWith(">") && !line.startsWith(">>"),
        tokens: line
          .split(marks)
          .map((piece, k): Inline | null =>
            k % 2
              ? inline(piece)
              : piece
                ? { kind: "text", text: piece }
                : null,
          )
          .filter((x) => x !== null),
      })),
    };
  });
}
