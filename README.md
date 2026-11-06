# Orbyn Planner

A simple planner for everyone: tasks, lists, projects, calendar and sharing. It runs on the web, desktop and phone from one React and TypeScript UI in the Orbyn house style, on top of [orbyn-engine](https://github.com/kinqsradio/orbyn-engine).

Status: early. Nothing here is released.

The plan, the feature map and the phases are in the [Orbyn platform plan](https://claude.ai/artifact/BBhxZSmXRg1DawhLVRbsNc).

## Layout

- `web/`: the React app (Vite, TypeScript).
- `web/src/generated/`: wire types generated from orbyn-engine's contracts. Do not edit by hand.
- `docs/architecture.md`: the contract for the UI. Its rules change in the same commit as the code.

## Checks

```bash
cd web && npm run check && npm test && npm run build
```

## Licence

No licence has been chosen yet, so all rights are reserved for now. The repository is public so the work can be followed.
