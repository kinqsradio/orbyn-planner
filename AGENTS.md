# Orbyn Planner

Read [docs/architecture.md](docs/architecture.md) before changing behaviour. Its rules are the contract; change it in the same commit as any change to them.

## Layout

- `web/`: the React app (Vite, TypeScript).
- `web/src/generated/`: wire types generated from orbyn-engine's contracts. Do not edit by hand.
- `docs/architecture.md`: the contract for the UI. Its rules change in the same commit as the code.

## Checks

```bash
cd web && npm run check && npm test && npm run build
```

## Delivery

- Branch from `main` with a short purpose name: `feat/`, `fix/`, `docs/`, `chore/` or `refactor/`.
- Open a pull request for every change. Merge only when every required check is green on the current head. Never weaken a check or merge red. Use a merge commit.
- Pull request and issue titles use `type(scope): summary`, at most 72 characters, with a kind from CONTRIBUTING.md.
- Every pull request fills in the template's AI usage section from what actually ran. The PR check fails while it is empty.
- Commits and branch names carry no agent or tool attribution: no `Co-Authored-By` trailer for an assistant, no generated-by line, no model or tool name. The AI usage section is the one place for it.
- Windows, macOS and Linux are all supported. Never add a Unix-only path, shell or signal without its Windows branch.
- Never commit secrets, real user data or files from your own machine. The repository is public.

Shared engineering methods live in the outer Orbyn Engineering library workspace. Do not copy them into this repository.
