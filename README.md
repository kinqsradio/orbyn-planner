# Orbyn Planner

A simple planner for everyone: tasks, lists, projects, calendar and sharing. It runs on the web, desktop and phone from one React and TypeScript UI in the Orbyn house style, on top of [orbyn-engine](https://github.com/orbyn-dev/orbyn-engine).

Status: early. Nothing here is released.

The plan, the feature map and the phases are in the internal Orbyn Platform Plan.

## Layout

- `web/`: the React app (Vite, TypeScript).
- `web/src/generated/`: wire types generated from orbyn-engine's contracts. Do not edit by hand.
- `desktop/`: the Tauri 2 desktop shell, a window around the web build. See [desktop/README.md](desktop/README.md).
- `docs/architecture.md`: the contract for the UI. Its rules change in the same commit as the code.

## Checks

```bash
cd web && npm run check && npm test && npm run build
```

## Licence

Orbyn Planner is source-available under the [PolyForm Strict License 1.0.0](LICENSE): you may read the source and use the app for personal, non-commercial purposes, but not copy, change or redistribute it. The engine crates it uses keep their own licences (MIT or Apache 2.0); see [orbyn-engine](https://github.com/orbyn-dev/orbyn-engine). Third-party packages keep their own licences and notices. The Orbyn name and logo are trademarks and are not licensed.
