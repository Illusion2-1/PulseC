import { createHash } from "node:crypto";
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import adapter from "@sveltejs/adapter-static";

const root = fileURLToPath(new URL(".", import.meta.url));
const hash = createHash("sha256");
const files = globSync(["src/**/*.*", "*.config.js", "package-lock.json"], {
  cwd: root,
}).sort();
for (const path of files) {
  hash
    .update(path)
    .update("\0")
    .update(readFileSync(new URL(path, import.meta.url)))
    .update("\0");
}

export default {
  kit: {
    adapter: adapter({ fallback: "index.html" }),
    version: { name: hash.digest("hex").slice(0, 16) },
    csp: {
      mode: "hash",
      directives: {
        "default-src": ["self"],
        "script-src": ["self"],
        "style-src": ["self"],
        "img-src": ["self", "data:"],
        "connect-src": ["self"],
        "base-uri": ["none"],
        "object-src": ["none"],
        "form-action": ["self"],
      },
    },
  },
};
