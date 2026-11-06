# Orbyn Planner architecture

The plan lives in the [Orbyn platform plan](https://claude.ai/artifact/BBhxZSmXRg1DawhLVRbsNc), and the screens in [Orbyn Planner Designs](https://claude.ai/artifact/7DCiHUzLLfBa3t8ojwiPVM). This file is the contract the UI follows. Change it in the same commit as any rule it states.

## Rules

- One UI for web, desktop and phone. Platform code stays in thin shells.
- The planner is for everyone: no student, engineer or business defaults, and no AI in v1.
- Orbyn house style: Geist and JetBrains Mono; Light, Dark and Dim; at most three interface colours: ink, amber when the person must act, and red for failures and removals. A person's list, calendar and project colours are content and keep their colour.
- Wire types come from orbyn-engine's contracts and are generated, never written by hand.
- The app works offline. A sync line always says whether this device is synced, syncing, offline with changes waiting, or unable to sync.
