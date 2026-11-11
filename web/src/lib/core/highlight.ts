import { common, createLowlight } from "lowlight";

const syntax = createLowlight(common);
// Guess among common snippet languages; explicit labels use the full registry.
const subset = [
  "javascript",
  "python",
  "json",
  "go",
  "bash",
  "cpp",
  "rust",
  "sql",
  "xml",
  "css",
];

export function highlight(lang: string, code: string) {
  if (lang)
    return syntax.registered(lang) ? syntax.highlight(lang, code) : undefined;
  const tree = syntax.highlightAuto(code, { subset });
  return tree.data?.language ? tree : undefined;
}
