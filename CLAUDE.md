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

### Public API

`api/v1/` is a static, read-only JSON API generated from `index.html` by `node scripts/build-api.mjs` (no dependencies). **After any data change, rebuild it and commit `api/v1/` in the same commit**; `--check` exits 1 if it's stale. Contract, shapes and traps are in `API.md`. Renaming or removing fields means a new `api/v2/`.

The legal basis is Blizzard's trademark guidelines, which allow non-commercial fan use with a credit line. Archon publishes rules and card sheets free but has no fan policy. The credit line lives in the `LEGAL` constant (shown at the bottom of the Cards tab and in every API response's `meta.legal`) and in the README. Keep the project non-commercial, and never put a Blizzard mark in a domain name.

### Features

- **Build:** race, scale (Skirmish 1000/100, Standard 2000/200, custom Grand Offensive), faction card, tactical cards and units. Tracks minerals, gas, and Core/Elite/Support/Air/Hero slots. The legality check flags over-budget lists, slot overflow, wrong faction tags, duplicate Uniques, Zerg without exactly one Creep card, and upgrades that replace the same weapon. Supports multiple saved rosters and copying a roster as text.
- **Setup:** priority calculation from both players' gas and minerals, plus the mission/deployment draft with full text.
- **Play:** round and phase tracking, Supply Pool and Available Supply (unlimited in the final round), VP for both sides with a game-end alert, exhaust/ready cards with auto-refresh each round, per-model casualty tracking that reduces Supply by profile, and the destroyed Supply your opponent scores.
- **Cards:** reference for all units, tactical cards and missions, by race.

## Data sources and provenance

- **Primary:** official rulebook and card PDFs/photos supplied by Dalton (May 2026 card sheets; Cocoon is from a v1.06.26 card).
- **Wave 2** (Siege Tank, Factory (Tech Lab), Ravager, Cocoon, Immortal, Zeratul, Nerazim Watchers, Nerazim faction, Robotics Facility, Void Seeker, Artefact Hunt mission, Meeting Engagement and Green Valleys deployments): verified against the official W2 card sheets in `Docs/Official Cards/*-W2-*.pdf` (Oct 2026). These were first imported from the community Command Center snapshot; the official cards corrected combat roles, Ravager base (80mm), `PIERCE Armoured` keywords, and the Siege Tank's Shock Cannon (RoA `BT+4`, SIEGE MODE only). The `src:"cc"` tag is gone from all data, but the renderer still supports it for future imports.
- **Wave 3** (Nova Stealth/Assault, Spec Ops Marauder, Raven, Holo Decoy, Sabotage Drone, Auto-Turret, Nova Covert Ops faction, Vanadium Plating; Zagara, Vileling, Defiler, Bile Launcher, Zagara's Swarm faction, Defiler Mound, Reactive Creep; Tassadar, Twilight Templar, High Templar, Templar Caste faction, Templar Archives; Fire in the Sky mission; One Bridge Too Close and Power Lines deployments): from the official W3 sheets in `Docs/Official Cards/*-W3-*.pdf` (v1.09.26, downloaded 31 Oct 2026 from starcraft-tmg.com/downloads). Text extracts sit next to them as `.txt`. Gotcha when reading the extracts: each phase heading comes *after* its block of abilities. Zagara's Broodmother is printed as an upgrade but has no cost in the table, so it's `c:[0]` with a visible `note`.
- **Costs:** reflect the **October 9, 2026 cost-table patch**. The authoritative file is `Docs/StarCraft-TMG-Cost-Table-10.2026_EN.pdf` (dated 09.10.2026), which corrected three costs the app had wrong: Spec Ops Marauder 230, Defiler 130, High Templar 130/200. `Docs/StarCraft-TMG-Cost-Table-09.2026_EN.pdf` is the older September table, so don't "fix" costs back to it.
- **Unreleased units** are cost-only stubs (`unk: true`, no abilities). As of 31 Oct 2026, after W3, there are none; the stub code paths stay for future cost tables.
- **Cocoon:** the official W2 sheet prints no BM value, so the app gives it `res:null` (no resource, can't be exhausted in Play). Confirmed against a physical card (Nov 2026): it supplies no BM.
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

Run `npm test` before every release. It runs three stages, cheapest first:

1. **`tests/logic.mjs`** (plain Node, no install): compiles the whole inline script (syntax), evaluates the pure-logic half with a stubbed `localStorage`, and checks `totals()`/`issues()` against hand-checked rulebook cases (e.g. Raynor's Raiders + Barracks, Barracks Proxy, Factory, Orbital, Academy and Eng Bay gives 8 Core, 2 Elite, 3 Support), plus data integrity (unique IDs, references resolve, upgrade costs line up with compositions). Add a case here when you fix a rules bug.
2. **`node scripts/build-api.mjs --check`**: `api/v1/` matches `index.html`.
3. **`tests/smoke.mjs`** (Playwright, 400×850): for each race it builds a legal roster, saves it, runs Setup, plays a game to the end, and opens and closes every card. Any `pageerror` or console error fails the run. Google Fonts are stubbed so it runs offline. `node tests/smoke.mjs --headed` shows the browser; `VERBOSE=1` prints each step.

First-time setup: `npm install`, then `npx playwright install chromium`. `package.json` is dev tooling only; the app still needs no build.

**CI:** `.github/workflows/test.yml` runs the same three stages on every push and PR. Pages deploys from `main` without waiting for it, so a red run is a warning, not a gate.

**Gotcha:** the UI re-renders after every click, so element handles go stale. Use Playwright locators (they re-query) instead of caching handles. A `<details>` picker also closes on every re-render, so open it again before each pick.

## Deploying

Commit to `main`. GitHub Pages redeploys automatically within a minute or two. Run `npm test` first.

## Next steps

Rough priority order. Confirm with Dalton before starting any of them.

1. ~~Commit the regression test~~ Done Nov 2026: `npm test` plus a GitHub Actions workflow (see Testing).
   - **Next up: tolerate stale IDs.** `totals()` throws if a saved roster or game references a unit or faction ID that no longer exists, which blanks the Build tab. Sanitize on load (drop or flag unknown IDs) before roster import ships or any ID is renamed.
2. **Roster export/import (JSON).** Rosters are trapped in each origin's localStorage. Export/import protects them and makes moving between web, offline and any future app possible.
3. **Bundle fonts locally** (`fonts/` folder plus `@font-face`) so offline use doesn't fall back to system fonts.
4. ~~Reconcile the in-app name~~ Done Oct 2026: title and header say SCTMG Data Disc. The localStorage `KEY` stays `sctmg-fieldkit-v1` on purpose, because renaming it would orphan everyone's saved rosters.
5. **Fill in the stubs** as unreleased units get real cards, removing the `unk` tags.
6. **Consider splitting data out of `index.html`** (e.g. `data/*.json`) if the file gets unwieldy. This is a trade-off against the single-file offline copy, so discuss it first.
7. **Optional Data Disc theming ideas (not yet decided):** `.disc` roster exports or "Data Disc #" share links, a Confederate terminal flavor ("ACCESSING…", "DECRYPTION COMPLETE"), unit "dossiers," and an empty-roster easter egg.
8. ~~Possible Android APK~~ Not needed for now (Nov 2026): Dalton is happy with Add to Home Screen. If it returns, a Capacitor wrapper (`index.html` in `www/`) is the lightest route and needs items 2 and 3 first, plus `@capacitor/app` back-button handling.

## Working with Dalton

- He's a self-taught full-stack developer, normally working in React/TS/Vite/Supabase/Tauri. Here he wants Claude to **explain what it's changing and why**, like a tutor, not just dump code.
- Be honest and direct about problems, but friendly. Enthusiasm and humor are welcome.
- Verify your own work (run the tests) before saying something is done.
