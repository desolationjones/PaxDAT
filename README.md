# PaxDAT

Offline tools for **Squarp Hapax** project files, built from a reverse-engineered
understanding of the format (`docs/FORMAT.md`).

Status: **phase 0, read-only inspector**. Nothing is ever written to your card.

| Part | What it is |
|---|---|
| `packages/core` | TypeScript codec for `project.dat`, `notes.dat`, `drums.dat`, `mpe.dat`, `autom.dat`, `settings.dat`, `AUTO.LOAD` and instrument definitions. Every reader has a mirror writer; the tests prove byte-identical round-trips |
| `packages/cli` | `paxdat inspect / diff / roundtrip` |
| `apps/web` | React inspector for the browser (Firefox-first): open a card or project folder, browse tracks, notes, FX, automation, song and settings, export JSON, compare projects |
| `tools/paxdat_probe.py` | the original Python research parser, kept as an independent cross-check |
| `docs/` | format notes, firmware notes, editor design |

## Use

Requires Node 22+ (developed on 24).

```sh
npm install
npm run dev                 # web inspector on http://localhost:5173 → "Open SD card or project folder"
npm run build               # static build in apps/web/dist (works from any folder)
npm test                    # golden round-trip + cross-check tests (uses ./Samples if present)

npm run paxdat -- inspect <card-or-project-dir> [--json] [--brief]
npm run paxdat -- diff <project-dir-a> <project-dir-b>
npm run paxdat -- roundtrip <card-or-project-dir>
```

Work on a **copy** of your SD card. The inspector reads files locally in the
browser and uploads nothing.

## Test data

Sample projects live in `Samples/` (git-ignored for now). The tests skip the
sample-based checks when the folder is absent.
