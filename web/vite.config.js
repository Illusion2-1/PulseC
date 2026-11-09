import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
export default defineConfig({
  plugins: [sveltekit()],
  build: { license: { fileName: "THIRD-PARTY-Web.txt" } },
});
