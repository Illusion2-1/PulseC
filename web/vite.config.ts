import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";

export default defineConfig({
  plugins: [sveltekit()],
  build: {
    // Even the smallest math fonts must use same-origin URLs under our CSP.
    assetsInlineLimit: (path) =>
      path.includes("/katex/dist/fonts/") ? false : undefined,
    license: { fileName: "THIRD-PARTY-Web.txt" },
  },
  // Rune modules must be compiled for the client so $state stays reactive in tests.
  resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
