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
| `generate` | Copy engine wire types into `src/generated/` |

- `VITE_ENGINE_URL`: engine base URL, default `http://localhost:8080`.
- `ORBYN_ENGINE_DIR`: orbyn-engine checkout for `generate`, default `../../../orbyn-engine-wt/foundation`. It reads `crates/orbyn-contracts/bindings/*.ts`.
