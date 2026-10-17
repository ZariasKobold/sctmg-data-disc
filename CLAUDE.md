# CLAUDE.md — SCTMG Data Disc

Context for Claude Code working in this repo. Read this before making changes.

## What this is

**SCTMG Data Disc** is an unofficial, free, fan-made companion app for Archon Studio's **StarCraft: Tabletop Miniatures Game (TMG)**. It is built and maintained by Dalton (GitHub: `zariaskobold`) under Draconic Designs as a **personal project**.

The name refers to the early StarCraft mission (The Jacobs Installation) where Raynor's crew steals a data disc from the Confederacy. A crew builder is, after all, a disc full of army data.

- **Repo:** `zariaskobold/sctmg-data-disc` (public, all-lowercase name)
- **Live site:** https://zariaskobold.github.io/sctmg-data-disc/ (GitHub Pages, deploys from `main` / root)

## Architecture

The whole app is **one self-contained file: `index.html`**. Markup, CSS and vanilla JS all live inline. There is no framework, bundler, build step or `package.json`.

- **External dependency:** Google Fonts only (Chakra Petch for display, Barlow for body), loaded via `<link>`. Everything else is inline.
- **Data:** hardcoded JS arrays in the script: `UNITS`, `TAC` (tactical/faction cards), `MISSIONS`, `DEPLOYS`, `SCALES`. Abilities are built with an `A(phase, name, type, text)` helper. Unit records use short keys (`id`, `n`, `r`, `tags`, `gas`, `slots`, `res`, `ab`, `uq`, `unk`, …).
- **Core logic:** `newBuild(race)`, `totals(build)` and `issues(build)` handle roster math and legality checks. Everything above the `/* ===================== UI HELPERS` marker is pure logic and can be tested in Node without a DOM.
- **Views:** four tabs, with containers `#v-build`, `#v-setup`, `#v-play` and `#v-cards`, switched by `nav button[data-v=…]`. The card detail modal closes with `#mClose`.
- **Storage:** `localStorage` under a `KEY` prefix (rosters, game state, `KEY+"-theme"`). Every read and write is wrapped in try/catch. Storage is per-origin, so data saved in the old Claude artifact or the offline file copy does **not** carry over to the GitHub Pages site.
- **Theming:** CSS custom properties on `:root`, with light and dark modes (system preference plus a manual `data-theme` override). Race accent colors come from `body[data-race="T|Z|P"]`, with Terran blue, Zerg purple and Protoss gold.
- **Layout:** mobile-first (it's used at the table on a phone). Fixed bottom tab bar, safe-area insets, max width of 720px.

### Features

- **Build:** race, scale (Skirmish 1000/100, Standard 2000/200, custom Grand Offensive), faction card, tactical cards and units. Tracks minerals, gas, and Core/Elite/Support/Air/Hero slots. The legality check flags over-budget lists, slot overflow, wrong faction tags, duplicate Uniques, Zerg without exactly one Creep card, and upgrades that replace the same weapon. Supports multiple saved rosters and copying a roster as text.
- **Setup:** priority calculation from both players' gas and minerals, plus the mission/deployment draft with full text.
- **Play:** round and phase tracking, Supply Pool and Available Supply (unlimited in the final round), VP for both sides with a game-end alert, exhaust/ready cards with auto-refresh each round, per-model casualty tracking that reduces Supply by profile, and the destroyed Supply your opponent scores.
- **Cards:** reference for all units, tactical cards and missions, by race.

## Data sources and provenance

- **Primary:** official rulebook and card PDFs/photos supplied by Dalton (May 2026 card sheets; Cocoon is from a v1.06.26 card).
- **Wave 2** (Siege Tank, Factory (Tech Lab), Ravager, Cocoon, Immortal, Zeratul, Nerazim Watchers, Nerazim faction, Robotics Facility, Void Seeker, Artefact Hunt mission, Meeting Engagement and Green Valleys deployments): verified against the official W2 card sheets in `Docs/Official Cards/*-W2-*.pdf` (Oct 2026). These were first imported from the community Command Center snapshot; the official cards corrected combat roles, Ravager base (80mm), `PIERCE Armoured` keywords, and the Siege Tank's Shock Cannon (RoA `BT+4`, SIEGE MODE only). The `src:"cc"` tag is gone from all data, but the renderer still supports it for future imports.
- **Costs:** reflect the **October 9, 2026 cost-table patch** (`Docs/StarCraft-TMG-Changelog-10.2026_EN.pdf`). `Docs/StarCraft-TMG-Cost-Table-09.2026_EN.pdf` is the older September table, so don't "fix" costs back to it.
- **Unreleased units** are cost-only stubs (`unk: true`, no abilities). As of Oct 2026, none of them have cards in `Docs/`.
- **Cocoon:** the official W2 sheet prints no BM value, so the app gives it `res:null` (no resource, can't be exhausted in Play). Confirm against a physical card.
- **Missions without an early-win lead** (Artefact Hunt) use `lead:null`; UI code must guard for it.

**Convention: be transparent about data quality.** Anything imported from an unofficial source, approximated, or missing card text carries a visible in-app tag (e.g. "imported from Command Center snapshot," "no card text"). Keep doing this for new data. Never silently present unverified stats as official.

## Decisions made

| Decision | Notes |
|---|---|
| Name: **SCTMG Data Disc** | "Data Disc" is the more defensible half if branding ever matters. Keep "SCTMG" loosely coupled. |
| **Free, personal, unofficial** | Selling it would need licensing from Blizzard/Archon, or a game-agnostic engine. Dalton chose to keep it non-commercial. The README carries the disclaimer. |
| **Single-file HTML, no build** | Keeps it trivially hostable, works offline from a saved copy, and is easy to wrap later. |
| **Hosting: GitHub Pages, public repo** | Replaced an earlier Cloudflare Pages plan. No new domain purchased. Trade-off accepted: the site and card data are fully public, with no login gating. |
| **Regression test before every release** | Added after a bad edit (a deleted `const MISSIONS` declaration) blanked every tab. See Testing. |

## Testing

There's no test framework in the repo yet. The established process before any release:

1. **Syntax check:** extract the inline `<script>` and run `node --check` on it.
2. **Logic check:** eval the pure-logic half (everything before `UI HELPERS`) in Node with a stubbed `localStorage`, build a sample roster, and confirm `totals()` and `issues()` match the rulebook. For example, Barracks, Barracks Proxy, Factory, Orbital, Academy and Eng Bay should give 8 Core, 2 Elite and 3 Support.
3. **Headless click-through (Playwright, 400×850 viewport):** load `index.html` and fail on any `pageerror`. Confirm every view renders non-empty. For each race, pick a faction, add units and tactical cards, start a game from Setup, advance phases, then open and close every unit, tactical and mission card in the Cards tab.

**Gotcha:** the UI re-renders after every click, so element handles go stale. Re-query selectors after each interaction instead of caching them.

Turning this into a committed `tests/` script is a next step (below).

## Deploying

Commit to `main`. GitHub Pages redeploys automatically within a minute or two. Run the tests first.

## Next steps

Rough priority order. Confirm with Dalton before starting any of them.

1. **Commit the regression test** as a real script (e.g. `tests/smoke.mjs`) with a minimal `package.json` for Playwright. Optionally run it in a GitHub Actions workflow on push.
2. **Roster export/import (JSON).** Rosters are trapped in each origin's localStorage. Export/import protects them and makes moving between web, offline and any future app possible.
3. **Bundle fonts locally** (`fonts/` folder plus `@font-face`) so offline use doesn't fall back to system fonts.
4. ~~Reconcile the in-app name~~ Done Oct 2026: title and header say SCTMG Data Disc. The localStorage `KEY` stays `sctmg-fieldkit-v1` on purpose, because renaming it would orphan everyone's saved rosters.
5. **Fill in the stubs** as unreleased units get real cards, removing the `unk` tags.
6. **Consider splitting data out of `index.html`** (e.g. `data/*.json`) if the file gets unwieldy. This is a trade-off against the single-file offline copy, so discuss it first.
7. **Optional Data Disc theming ideas (not yet decided):** `.disc` roster exports or "Data Disc #" share links, a Confederate terminal flavor ("ACCESSING…", "DECRYPTION COMPLETE"), unit "dossiers," and an empty-roster easter egg.
8. **Possible Android APK (proposed, not decided):** a Capacitor wrapper was suggested as the lightest route (`npx cap init`, with `index.html` in `www/`). If pursued, it needs items 2 and 3 first, plus `@capacitor/app` back-button handling so Back closes modals instead of the app.

## Working with Dalton

- He's a self-taught full-stack developer, normally working in React/TS/Vite/Supabase/Tauri. Here he wants Claude to **explain what it's changing and why**, like a tutor, not just dump code.
- Be honest and direct about problems, but friendly. Enthusiasm and humor are welcome.
- Verify your own work (run the tests) before saying something is done.
