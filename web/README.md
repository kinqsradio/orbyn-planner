# Orbyn Planner web

React 19, TypeScript and Vite, in the Orbyn house style.

```bash
npm ci
npm run dev        # http://localhost:5173
```

| Script | Does |
| --- | --- |
| `dev` | Vite dev server |
| `build` | Type-check, then production build into `dist/` |
| `check` | Type-check and lint |
| `test` | Vitest |
| `generate` | Copy engine wire types into `src/generated/` (needs `ORBYN_ENGINE_DIR`) |
| `generate:check` | Fail if `src/generated/` differs from the engine's bindings; CI runs it against the engine commit pinned in `src/generated/wasm/manifest.json` |

- `VITE_ENGINE_URL`: engine base URL, default `http://localhost:8080`.
- `ORBYN_ENGINE_DIR`: orbyn-engine checkout for `generate` and `generate:check`; required, with no default, and it must be at the pinned commit (`src/generated/wasm/manifest.json`; the script refuses any other). It reads `crates/orbyn-contracts/bindings/*.ts`. Moving the pin is deliberate: `npm run wasm` on Linux from the new commit, then `npm run generate` from that same commit, in one change.
