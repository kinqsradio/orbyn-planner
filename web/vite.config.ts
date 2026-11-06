import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * The engine's module is imported only when the build has an engine address (see src/api/realCrypto.ts).
 * Without one the import is dropped from the code, but Vite has already emitted the .wasm that the glue
 * file names; this removes it when no chunk refers to it, so such a build ships no WebAssembly.
 */
function dropUnusedWasm(): Plugin {
  return {
    name: "drop-unused-wasm",
    generateBundle(_options, bundle) {
      const code = Object.values(bundle).map((o) => (o.type === "chunk" ? o.code : "")).join("\n");
      for (const [name, output] of Object.entries(bundle)) {
        if (output.type === "asset" && name.endsWith(".wasm") && !code.includes(name.split("/").pop()!)) delete bundle[name];
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), dropUnusedWasm()],
  // The desktop shell loads this address in development, so it must not move to another port.
  server: { port: 5173, strictPort: true },
  clearScreen: false,
  // The engine's module is a .wasm asset: loaded by URL in the app, and as bytes (?inline) in the Node tests.
  assetsInclude: ["**/*.wasm"],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    globals: false,
  },
});
