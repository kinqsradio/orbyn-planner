# Orbyn Planner desktop

A thin Tauri 2 shell around the web app in `../web`: one window, the standard menus, and the window's size and position remembered. It has no commands for the page to call and no network code; the page talks to the engine itself.

## Needs

Node 22, the stable Rust toolchain (1.90 or newer) and the [Tauri system requirements](https://tauri.app/start/prerequisites/) for your platform.

## Run

```bash
cd web && npm ci && cd ../desktop && npm ci
npm run dev      # starts the web dev server and opens the window on it
npm run build    # builds the web app, then the app and its installer
```

The engine address is set in `config.json` (`engineUrl`). `scripts/tauri.mjs` writes it into the content security policy, so the window may fetch from that one origin and nothing else.

## Icons

`app-icon.svg` is the source. After changing it, run `npm run icons` and commit `src-tauri/icons/`.

## Checks

```bash
npm test                          # the config and CSP scripts
cd src-tauri && cargo test        # the navigation allowlist
cd src-tauri && cargo clippy
```

Releases are not signed or notarised yet; installers are for testing.
