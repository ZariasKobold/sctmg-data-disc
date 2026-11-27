# CLAUDE.md — SCTMG Data Disc

Context for Claude Code working in this repo. Read this before making changes.

## What this is

**SCTMG Data Disc** is an unofficial, free, fan-made companion app for Archon Studio's **StarCraft: Tabletop Miniatures Game (TMG)**. It is built and maintained by Dalton (GitHub: `zariaskobold`) under Draconic Designs as a **personal project**.

The name refers to the early StarCraft mission (The Jacobs Installation) where Raynor's crew steals a data disc from the Confederacy. A crew builder is, after all, a disc full of army data.

- **Repo:** `zariaskobold/sctmg-data-disc` (public, all-lowercase name)
- **Live site:** https://sctmgdatadisc.com/ (Cloudflare Workers static assets, auto-deploys from `main`). The old GitHub Pages URL, https://zariaskobold.github.io/sctmg-data-disc/, still deploys from `main` / root as a mirror.

## Architecture

The whole app is **one self-contained file: `index.html`**. Markup, CSS and vanilla JS all live inline. There is no framework, bundler or build step. It still works fully offline and on the github.io mirror; online features switch on only when it's served by the Worker.

The optional online half is a small **Cloudflare Worker** in `worker/` (plain JS, no dependencies) with a **D1** database (schema in `migrations/`). It only handles `/auth/*` and `/sync/*`; everything else is static files.

- **External dependency:** Google Fonts only (Chakra Petch for display, Barlow for body), loaded via `<link>`. Everything else is inline.
- **Data:** hardcoded JS arrays in the script: `UNITS`, `TAC` (tactical/faction cards), `MISSIONS`, `DEPLOYS`, `SCALES`, `GLOSSARY`. Abilities are built with an `A(phase, name, type, text)` helper. Unit records use short keys (`id`, `n`, `r`, `tags`, `gas`, `slots`, `res`, `ab`, `uq`, `unk`, …).
- **Core logic:** `newBuild(race)`, `totals(build)` and `issues(build)` handle roster math and legality checks. Everything above the `/* ===================== UI HELPERS` marker is pure logic and can be tested in Node without a DOM.
- **Views:** five tabs, with containers `#v-build`, `#v-setup`, `#v-play`, `#v-cards` and `#v-gloss`, switched by `nav button[data-v=…]`. The card detail modal closes with `#mClose`. Glossary definitions open in a second `<dialog id="gloss">` that stacks on top of the card modal (`#gClose`, `#gBack`).
- **Storage:** `localStorage` under a `KEY` prefix (rosters, game state, `KEY+"-theme"`). Every read and write is wrapped in try/catch. Storage is per-origin, so data saved in the old Claude artifact, the offline file copy or the github.io mirror does **not** carry over to the live site. Signed-in players also have their saved rosters in D1 (see Accounts and online play); the current build and solo games stay local only.
- **Theming:** CSS custom properties on `:root`, with light and dark modes. **Dark is the default** (Nov 2026, Dalton's call), whatever the system setting: dark rules use `:root:not([data-theme="light"])`, so light applies only after the player picks it with the ◐ toggle (saved as `KEY+"-theme"`). Doing it in CSS, not on load in JS, avoids a light flash. Race accent colors come from `body[data-race="T|Z|P"]`, with Terran blue, Zerg purple and Protoss gold. The sci-fi **HUD skin** (Nov 2026) is one block at the end of the `<style>` (`/* HUD SKIN */`) layered over the base styles: starfield/nebula backdrop, frosted header and tab bar with a glowing accent rail, panels with corner brackets, chamfered buttons, segmented meters. It's driven by `--hl`, `--glow` and `--tint`, set on `body` so they follow the race accent; `--glow` is transparent in light mode. Headings are uppercased with CSS, so browser tests read `textContent`, not `innerText`.
- **Layout:** mobile-first (it's used at the table on a phone, and Dalton plays on a Galaxy Fold in tablet mode). Fixed bottom tab bar, safe-area insets, 720px reading column. **Responsive plan (Nov 2026):** wider screens only *rearrange* the same panels side by side; no desktop-only features, and phones keep the pop-up card sheet. CSS lives in the `/* WIDE SCREENS */` block. Phase 1 done: at 760px+ Cards is list + sticky detail panel (`cardSel`, `paintCardDetail()`, `wideCards()` must match the CSS breakpoint) and Glossary pins its filters beside a single-column list; at 1100px+ the tab bar becomes a framed "Command" side rail and dialogs centre. Planned next: Build in two/three columns, Play with both armies side by side (for the Fold), then Setup.
- **Installable app (PWA):** `manifest.webmanifest`, `sw.js` and `icons/` sit next to `index.html`, all with relative paths so the github.io mirror works too. The service worker registers only over http(s), never on the offline file copy. The app page is network-first (fresh whenever there's signal, the saved copy after 4 s or offline), icons are precached, and Google Fonts are cache-first once seen. It never touches `/auth/*`, `/sync/*` or `/api/*`. Bump `VERSION` in `sw.js` only when its `PRECACHE` list changes. **Branding:** Dalton's own logo and icon art (Nov 2026) live full-size in `art/` (not published, listed in `.assetsignore`). `node scripts/build-icons.mjs` (uses `sharp`) shrinks them into `icons/`: the app icons, a maskable icon (ring and chip only), `favicon-64.png`, and `logo.webp`, which is the header logo. The source logo has an opaque near-black background, so the script flood-fills it away from the edges (`cutBackground()`) and keeps the dark plate behind the lettering so it reads on the light theme. The logo is used as (`img.brand`, alt text "SCTMG Data Disc"). Replace the art in `art/`, rerun the script and commit `icons/`. The `theme-color` meta follows the light/dark toggle (`syncThemeColor()`).

### Accounts and online play (`worker/`)

- **Sign-in:** Discord OAuth (`identify` scope only). `/auth/login` → Discord → `/auth/callback` exchanges the code with `DISCORD_CLIENT_SECRET`, upserts the user, and sets an HttpOnly session cookie (`sdd_s`, 180 days). Only the SHA-256 of the token is stored. We keep Discord ID, display name and avatar hash; no email.
- **`/auth/dev?name=X`:** local testing login. Works only with `DEV_LOGIN=1` (from `--var` or `.dev.vars`, never set in production) **and** a localhost URL.
- **CSRF:** every non-GET request must carry an `Origin` equal to the site's own; cookies are `SameSite=Lax`.
- **Roster sync:** `/sync/rosters`. One row per roster, newest `updated` wins, deletes are tombstones (`st.tomb` on the client). Client side is `syncRosters()` / `mergeRosters()` (pure, tested). Syncs on sign-in, on save/delete, and when the tab regains focus (at most every 30 s).
- **Share links:** `/sync/shares` makes an 8-character code; `/#share=CODE` opens a read-only preview anyone can import, no sign-in needed.
- **Online games:** `/sync/games`. Host gets a 6-character code (no 0/O/1/I/L), guest joins with it. State JSON lives in `games.state` with a `version`; writes are compare-and-swap on the version (D1 has no interactive transactions). Clients poll every 3 s (`?v=N` returns `{same:true}` when nothing changed). Rules for ops are in `worker/game.js` (pure, tested):
  - `side`: a player replaces **only their own** units and cards.
  - `vp`: either player adjusts either score by a delta (so two quick taps can't overwrite each other).
  - `step`: Next/Back carries the round/phase the player saw, so both tapping Next advances once.
  - Phase/Round bookkeeping (activations reset, cards refresh, Supply snapshots) is done by **each client on its own side** when it sees the step change: `applyRemoteState()` in `index.html`.
- **Account delete** (`DELETE /auth/account`) removes the user; `ON DELETE CASCADE` takes sessions, rosters, shares and games with it.

### Public API

`api/v1/` is a static, read-only JSON API generated from `index.html` by `node scripts/build-api.mjs` (no dependencies). **After any data change, rebuild it and commit `api/v1/` in the same commit**; `--check` exits 1 if it's stale. Contract, shapes and traps are in `API.md`. Renaming or removing fields means a new `api/v2/`.

The legal basis is Blizzard's trademark guidelines, which allow non-commercial fan use with a credit line. Archon publishes rules and card sheets free but has no fan policy. The credit line lives in the `LEGAL` constant (shown at the bottom of the Cards tab and in every API response's `meta.legal`) and in the README. Keep the project non-commercial, and never put a Blizzard mark in a domain name.

### Features

- **Build:** race, scale (Skirmish 1000/100, Standard 2000/200, custom Grand Offensive), faction card, tactical cards and units. Tracks minerals, gas, and Core/Elite/Support/Air/Hero slots. The legality check flags over-budget lists, slot overflow, wrong faction tags, duplicate Uniques, Zerg without exactly one Creep card, and upgrades that replace the same weapon. Supports multiple saved rosters, **Save as new** (`copyAsNew()`, a fresh ID so the original isn't overwritten) and copying a roster as text. Rosters can be exported (this roster or all saved ones, the player picks) and imported as a Data Disc file (`exportData()`/`importData()`; rosters already saved come back as `dupes` and the player can save them as new copies via `asNewCopies()`), pasted back in from "Copy as text" (`parseRosterText()`), and, when signed in, synced and shared by link.
- **Setup:** priority calculation from both players' gas and minerals, plus the mission/deployment draft with full text. Signed-in players can host an online game (gets a code) or join one, and resume their recent online games on any device.
- **Play:** round and phase tracking, Supply Pool and Available Supply (unlimited in the final round), VP for both sides with a game-end alert, exhaust/ready cards with auto-refresh each round, per-model casualty tracking that reduces Supply by profile, and the destroyed Supply your opponent scores.
- **Online play:** both players see the same Round, Phase and VP, and each other's army (units, models left, deployed/activated, exhausted cards, destroyed Supply). A solo game on one device still works exactly as before.
- **Cards:** reference for all units, tactical cards and missions, by race.
- **Glossary:** searchable, filterable list of game terms. Terms inside card text, kind tags, weapon tables, stat labels, mission text and the Play phase reference are tappable and open a definition sheet. `linkTerms()` / `rt()` do the linking (escape first, then link; each term once per paragraph, case-sensitive).

## Data sources and provenance

- **Primary:** official rulebook and card PDFs/photos supplied by Dalton (May 2026 card sheets; Cocoon is from a v1.06.26 card).
- **Wave 2** (Siege Tank, Factory (Tech Lab), Ravager, Cocoon, Immortal, Zeratul, Nerazim Watchers, Nerazim faction, Robotics Facility, Void Seeker, Artefact Hunt mission, Meeting Engagement and Green Valleys deployments): verified against the official W2 card sheets in `Docs/Official Cards/*-W2-*.pdf` (Oct 2026). These were first imported from the community Command Center snapshot; the official cards corrected combat roles, Ravager base (80mm), `PIERCE Armoured` keywords, and the Siege Tank's Shock Cannon (RoA `BT+4`, SIEGE MODE only). The `src:"cc"` tag is gone from all data, but the renderer still supports it for future imports.
- **Wave 3** (Nova Stealth/Assault, Spec Ops Marauder, Raven, Holo Decoy, Sabotage Drone, Auto-Turret, Nova Covert Ops faction, Vanadium Plating; Zagara, Vileling, Defiler, Bile Launcher, Zagara's Swarm faction, Defiler Mound, Reactive Creep; Tassadar, Twilight Templar, High Templar, Templar Caste faction, Templar Archives; Fire in the Sky mission; One Bridge Too Close and Power Lines deployments): from the official W3 sheets in `Docs/Official Cards/*-W3-*.pdf` (v1.09.26, downloaded 31 Oct 2026 from starcraft-tmg.com/downloads). Text extracts sit next to them as `.txt`. Gotcha when reading the extracts: each phase heading comes *after* its block of abilities. Zagara's Broodmother is printed as an upgrade but has no cost in the table, so it's `c:[0]` with a visible `note`.
- **Wave 4** (Zerg: Stukov, Infested Trooper, Infested Marine, Infested Missile Turret, Infested Goliath, Infested Siege Tank, Stukov's Forces faction, Virus cards Healing Pathogen / Hungering Infestation / Weighted Pustule, Infested Barracks, Infested Command Center, Hive. Terran: Firebat, Barracks (Reactor). Protoss: Tal'darim faction, Alarak, Slayer (Stalker), Reaver, Scarab / Phasing Scarab / Solarite Scarab, Tal'darim Pylon, Robotics Support Bay): from **Archon's official online card database, sc.starcraft-tmg.com** (screenshots from Dalton, Nov 2026). No PDF sheet yet, so combat role isn't known, and base size only for four units: Firebat, Stukov and Infested Marine 40mm, Reaver 150mm, read off v1.10.26 card photos from r/StarCraftTMG (Nov 2026, may be pre-release; `baseSrc:W4PHOTO`, shown on the card and as API `baseSource`). Those photos are used for bases only: where they disagree with the database on abilities, phases, upgrades or Unique, the database wins until official print-and-play cards are out. Tagged `src:"w4"`, which shows a small "Wave 4" source note on the card. API `status` is `"official"` with `combatRole` null and `base` null except those four. Costs come from the database, not a cost table, so check them when the next cost table lands. Infested Goliath/Siege Tank are the faction's *Ashes of the UED* rule (Terran Ground Mechanical units join as Infested): built as copies of the Terran cards at the end of `UNITS`, not separate data. Stukov's Forces takes one **Virus** card instead of a Creep card (faction field `need:"Virus"`, checked in `issues()`). Oddities kept and noted: the Infested Marine's Wild Mutation costs 1 and says "for Infested C-14 Rifle". The Tal'darim Faction Card shows no Resource, so it's `res:null` with a visible `note`. Robotics Support Bay prints "+1 EN", read as PE. Tactical/faction cards can now carry a `note` (shown on the card, and in the API). The database gives Holo Decoy a Biological tag the W3 PDF doesn't print; the app keeps the PDF's "Psionic, Ground".
- **Costs:** reflect the **October 9, 2026 cost-table patch**. The authoritative file is `Docs/StarCraft-TMG-Cost-Table-10.2026_EN.pdf` (dated 09.10.2026), which corrected three costs the app had wrong: Spec Ops Marauder 230, Defiler 130, High Templar 130/200. `Docs/StarCraft-TMG-Cost-Table-09.2026_EN.pdf` is the older September table, so don't "fix" costs back to it.
- **Unreleased units** are cost-only stubs (`unk: true`, no abilities). As of 31 Oct 2026, after W3, there are none; the stub code paths stay for future cost tables.
- **Cocoon:** the official W2 sheet prints no BM value, so the app gives it `res:null` (no resource, can't be exhausted in Play). Confirmed against a physical card (Nov 2026): it supplies no BM.
- **Missions without an early-win lead** (Artefact Hunt) use `lead:null`; UI code must guard for it.
- **Glossary:** definitions are short summaries **in our own words** (not the rulebook's text), each citing its Core Rules section, mostly Part 11 ("Keyword Glossary and Definitions"). When a new keyword appears on a card, add a `G(...)` entry; `tests/logic.mjs` fails on any BOLD CAPS card word the glossary can't link.
- **Renaming an ID:** saved rosters reference IDs. Add `{oldId:"newId"}` to `RENAMED` so rosters follow the rename. Unknown IDs are dropped on load by `cleanState()` and listed to the player, never crash the app.

**Convention: be transparent about data quality.** Anything imported from an unofficial source, approximated, or missing card text carries a visible in-app tag (e.g. "imported from Command Center snapshot," "no card text"). Keep doing this for new data. Never silently present unverified stats as official.

## Decisions made

| Decision | Notes |
|---|---|
| Name: **SCTMG Data Disc** | "Data Disc" is the more defensible half if branding ever matters. Keep "SCTMG" loosely coupled. |
| **Free, personal, unofficial** | Selling it would need licensing from Blizzard/Archon, or a game-agnostic engine. Dalton chose to keep it non-commercial. The README carries the disclaimer. |
| **Single-file HTML, no build** | Keeps it trivially hostable, works offline from a saved copy, and is easy to wrap later. |
| **Accounts: Discord sign-in, data in D1** | Nov 2026, Dalton's call (his friends already use Discord). Online features are optional; the app must keep working signed out, offline and on the github.io mirror. |
| **Online sync by polling, not WebSockets** | Every 3 s while a game is open, against D1. Simple, survives phones sleeping, and well inside the free tier for a friends-sized group. Durable Objects + WebSockets is the upgrade path if it ever feels laggy. |
| **Domain: sctmgdatadisc.com** | Nov 2026, Dalton's call after checking: "SCTMG" is a community abbreviation, not a registered Blizzard mark (other fan sites use it too), so it doesn't break the no-Blizzard-mark-in-a-domain rule. Keep the site non-commercial, unofficial and clearly credited, and never imply endorsement. |
| **Hosting: Cloudflare Workers at sctmgdatadisc.com, public repo** | Nov 2026: moved from GitHub Pages (kept as a mirror) to a Workers static-assets deploy on Dalton's own domain. Trade-off accepted: the site and card data are fully public, with no login gating. |
| **Regression test before every release** | Added after a bad edit (a deleted `const MISSIONS` declaration) blanked every tab. See Testing. |

## Testing

Run `npm test` before every release. It runs five stages, cheapest first:

1. **`tests/logic.mjs`** (plain Node, no install): compiles the whole inline script (syntax), evaluates the pure-logic half with a stubbed `localStorage`, and checks `totals()`/`issues()` against hand-checked rulebook cases (e.g. Raynor's Raiders + Barracks, Barracks Proxy, Factory, Orbital, Academy and Eng Bay gives 8 Core, 2 Elite, 3 Support), plus data integrity (unique IDs, references resolve, upgrade costs line up with compositions). Add a case here when you fix a rules bug.
   It also round-trips every unit, squad size and upgrade through Copy as text → Paste text, and checks file import, the sync merge and online round/phase bookkeeping.
2. **`tests/worker.mjs`** (plain Node): the online-game op rules in `worker/game.js`.
3. **`node scripts/build-api.mjs --check`**: `api/v1/` matches `index.html`.
4. **`tests/smoke.mjs`** (Playwright, 400×850, offline file): for each race it builds a legal roster, saves it, runs Setup, plays a game to the end, and opens and closes every card. Any `pageerror` or console error fails the run. Google Fonts are stubbed so it runs offline. `node tests/smoke.mjs --headed` shows the browser; `VERBOSE=1` prints each step.
   It also uses Save as new, exports a single roster and then all of them, imports the file back (then again, once skipping the already-saved rosters and once saving them as new) and pastes roster text. Finally it resizes to 840px (Fold) and 1440px (desktop) to check the Cards side panel, the side rail and every view, then back to phone width.
5. **`tests/online.mjs`** (Playwright + `wrangler dev` on a throwaway local D1 with `DEV_LOGIN`): Alice on two devices and Bob. Roster sync and deletes, a share link, host/join by code, VP, deploys, activations, exhausts, Next from either player (and both at once), new-Round refresh, resume on a second device, ending a game and deleting an account. Player contexts block service workers; a separate check loads the manifest and icons, lets `sw.js` install, then reloads offline and expects the app to open.

First-time setup: `npm install`, then `npx playwright install chromium`. `package.json` is dev tooling only (Playwright, Wrangler); the app still needs no build.

**Run it locally with sign-in:** `npm run dev` (applies migrations to a local D1, then `wrangler dev` with `DEV_LOGIN`). Open `http://localhost:8787/auth/dev?name=Alice`, and a second browser profile with `?name=Bob`.

**CI:** `.github/workflows/test.yml` runs the same five stages on every push and PR. Cloudflare and Pages both deploy from `main` without waiting for it, so a red run is a warning, not a gate.

**Gotcha:** the UI re-renders after every click, so element handles go stale. Use Playwright locators (they re-query) instead of caching handles. A `<details>` picker also closes on every re-render, so open it again before each pick.

## Deploying

Commit to `main`. Run `npm test` first. Cloudflare Workers Builds redeploys sctmgdatadisc.com automatically (no build command; deploy command `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`, so new files in `migrations/` apply first), and GitHub Pages redeploys the static mirror (no sign-in there).

- **`wrangler.jsonc`**: Worker name, `main` (`worker/index.js`), static assets from the repo root with `run_worker_first` for `/auth/*` and `/sync/*`, the D1 binding `DB`, and the public `DISCORD_CLIENT_ID`. The custom domain is attached in the dashboard (Worker > Settings > Domains & Routes).
- **Secret `DISCORD_CLIENT_SECRET`**: set in the dashboard (Worker > Settings > Variables and Secrets). Never in git or `wrangler.jsonc`.
- **Discord app:** Developer Portal > OAuth2 > Redirects must list `https://sctmgdatadisc.com/auth/callback` (and the workers.dev URL's `/auth/callback` if that's used).
- **Schema changes:** add a new numbered file in `migrations/`; never edit an applied one.
- **`.assetsignore`**: keeps dev files (`tests/`, `scripts/`, `worker/`, `migrations/`, `*.md`, `package*.json`, `Docs/` …) off the live site. **Add new non-site files or folders here**, or they get published.
- **`_headers`**: sends `Access-Control-Allow-Origin: *` on `/api/*`, which GitHub Pages did by default and Cloudflare doesn't.

## Next steps

Rough priority order. Confirm with Dalton before starting any of them.

1. ~~Commit the regression test~~ Done Nov 2026: `npm test` plus a GitHub Actions workflow (see Testing).
   - ~~Tolerate stale IDs~~ Done Nov 2026: `cleanState()` on load, plus `RENAMED` for planned renames. File import, sync and share links all go through `cleanBuild()` too.
2. ~~Roster export/import~~ Done Nov 2026: Data Disc file export/import, paste text, plus Discord sign-in with roster sync, share links and online games.
3. **Bundle fonts locally** (`fonts/` folder plus `@font-face`) so offline use doesn't fall back to system fonts. Partly covered since Nov 2026: the installed app's service worker keeps the fonts after the first online visit. Still useful for the downloaded file copy and a first visit made offline.
4. ~~Reconcile the in-app name~~ Done Oct 2026: title and header say SCTMG Data Disc. The localStorage `KEY` stays `sctmg-fieldkit-v1` on purpose, because renaming it would orphan everyone's saved rosters.
5. **Fill in the stubs** as unreleased units get real cards, removing the `unk` tags.
6. **Consider splitting data out of `index.html`** (e.g. `data/*.json`) if the file gets unwieldy. This is a trade-off against the single-file offline copy, so discuss it first.
7. **Optional Data Disc theming ideas (not yet decided):** `.disc` roster exports or "Data Disc #" share links, a Confederate terminal flavor ("ACCESSING…", "DECRYPTION COMPLETE"), unit "dossiers," and an empty-roster easter egg.
8. ~~Possible Android APK~~ Not needed for now (Nov 2026): Dalton is happy with Add to Home Screen, and the site is now an installable PWA that opens offline. If an APK returns, a Capacitor wrapper (`index.html` in `www/`) is the lightest route and needs item 3 first, plus `@capacitor/app` back-button handling.

## Working with Dalton

- He's a self-taught full-stack developer, normally working in React/TS/Vite/Supabase/Tauri. Here he wants Claude to **explain what it's changing and why**, like a tutor, not just dump code.
- Be honest and direct about problems, but friendly. Enthusiasm and humor are welcome.
- Verify your own work (run the tests) before saying something is done.
