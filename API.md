# Data Disc's API: how it works, and how to keep it right

A handoff for a session (or a developer) that hasn't worked with it before.
Written 2026-10-31, when the data covered waves 1–3 and the 09.10.2026 cost
table. **Where a claim matters, fetch the file and look.** It's quicker than
reasoning about what the build script ought to produce.

---

## What it is

A **static, read-only JSON API** for StarCraft: Tabletop Miniatures Game data
(units, faction/tactical/creep cards, missions, deployments, army scales),
served by Cloudflare next to the app at sctmgdatadisc.com.

- **Base:** `https://sctmgdatadisc.com/api/v1/`
- **Auth:** none. Plain `GET`s of `.json` files.
- **CORS:** `/api/*` responses send `Access-Control-Allow-Origin: *` (set in the
  repo's `_headers` file), so browser apps on any origin can `fetch()` it
  directly. No proxy needed.
- **Rate limit:** none of ours. Cloudflare's CDN serves it. Cache what you
  fetch anyway; the data only
  changes when a card wave or cost patch lands.
- **Unofficial and non-commercial.** Every response carries `meta.legal`. If you
  build on this, keep that notice visible and keep your project non-commercial.
  That's the basis on which the data is published (Blizzard's trademark
  guidelines allow non-commercial fan use with credit).

The site also has `/auth/*` and `/sync/*` routes for sign-in, roster sync and online games. Those belong to the app, need a signed-in session, and aren't part of this public API.

### Static means static

There's no server, so there are **no query strings, no search, no filtering,
no pagination and no writes**. `units.json?race=zerg` returns the same file as
`units.json`. Fetch the list and filter it client-side. The whole API is under
1 MB, so that's cheap.

---

## Where it comes from

`index.html` is the single source of truth. `scripts/build-api.mjs` evaluates
the pure-data half of its inline script (everything above the
`/* ===================== UI HELPERS` marker), reshapes the app's short keys
(`n`, `r`, `st`, `comps`…) into readable names, and writes `api/v1/`.

```bash
node scripts/build-api.mjs
```

```bash
node scripts/build-api.mjs --check
```

The first rebuilds `api/v1/` (it deletes and rewrites the folder). The second
writes nothing and exits 1 if `api/v1/` doesn't match `index.html`, so it can
gate a commit or CI. It needs only Node, with no `npm install`.

**Run the build after every data change to `index.html`, and commit `api/v1/`
in the same commit.** Nothing regenerates it automatically yet, and a stale
API is a silent bug: the app shows the new data while the API keeps serving
the old.

---

## Response envelope

Every file has the same shape, borrowed from BiggerHat:

```json
{ "data": [ ... ], "meta": { "count": 45, ... } }   // a list
{ "data": { ... }, "meta": { ... } }                // one record
```

`meta` always has:

| Field | Meaning |
|---|---|
| `api` | `"v1"` |
| `dataVersion` | First 12 hex chars of a SHA-256 over all the data. Changes when *any* data changes, and only then. Use it as a cache key. |
| `costs` | Which official cost table the mineral and gas costs follow. |
| `cards` | Which official card sheets the text follows. |
| `docs` | Link to this file. |
| `legal` | The non-commercial / trademark notice. |

Lists add `count`.

---

## Endpoints

All paths are relative to the base.

| File | Contents |
|---|---|
| `index.json` | API name, base URL, endpoint list, record counts. |
| `units.json` | Every unit, all three races, including summoned units. |
| `units/{id}.json` | One unit. |
| `cards.json` | Every faction, tactical and creep card. |
| `cards/{id}.json` | One card. |
| `missions.json` | Every mission, with Standard and Skirmish sides. |
| `missions/{id}.json` | One mission. |
| `deployments.json` | Every deployment card. |
| `scales.json` | Skirmish / Standard / Grand Offensive mineral and gas limits. |
| `glossary.json` | Game terms and keywords with short plain-English definitions. |

IDs are the app's own (`marine`, `novastealth`, `zagswarm`, `fireinsky`).
They're stable because saved rosters reference them. **An unknown ID is a
404 page (HTML), not JSON.** Check `response.ok` before parsing.

---

## Record shapes

Field names are camelCase.

**Unit** (`units/{id}.json`):

- `id`, `name`, `race` (`terran` / `zerg` / `protoss`)
- `factionTags: string[]`: tags the army's **Faction Card** must carry for the
  unit to be legal. `["Terran"]` fits any Terran faction;
  `["Terran","Nova Covert Ops"]` needs the Nova Covert Ops faction.
- `status`: `"official"` (from an official card sheet or Archon's online card database;
  Wave 4 cards come from the database and have `combatRole` and `base` null)
  or `"cost-only"` (in the cost
  table, no card yet: stats, abilities and weapons will be empty or null)
- `summoned`: true for units that are set by an ability (Auto-Turret, Pylon,
  Omega Worm…). They have no cost, no `armySlot` and empty `compositions`.
- `unique`, `armySlot` (`Core` / `Elite` / `Support` / `Air` / `Hero`),
  `combatRole`, `base`
- `stats: { shield, speed, armour, evade, hitPoints, size }` (see traps)
- `combatTags: string[]`: `Biological`, `Armoured`, `Ground`, `Flying`…
- `supplyByModels: [{ min, max, supply }]`: current Supply Value by models alive
- `compositions: [{ models, minerals, supply }]`: the sizes you can buy
- `abilities: [{ phase, name, kind, text }]`: `phase` is `Any` / `Movement` /
  `Assault` / `Combat`. `kind` is e.g. `"Passive"`, `"Active · 1 CP"`,
  `"Reaction · 1 BM · Repeatable"`.
- `weapons: [{ phase, name, range, target, rateOfAttack, hit, surgeType[], surgeDice, damage, keywords[] }]`
- `upgrades: [{ name, cost[], phase, kind, text, specialist, replaces, weapon }]`.
  `cost` has one entry per composition, in the same order. `weapon` is set
  when the upgrade is (or adds) a weapon. `replaces` names the weapon it
  swaps out.
- `cannotBeTakenWith: string[]`: unit IDs that can't share an army with this
  one (Nova's two modes).
- `note`: free-text caveat, or null.

**Card** (`cards/{id}.json`): `id`, `name`, `race`, `type` (`faction` /
`tactical` / `creep` / `virus`), `factionTags`, `status`, `unique`, `gas`,
`armySlots: { Core: 3, Hero: 1, … }` (only slots it grants),
`resource: { type: "CP"|"BM"|"PE", amount }` or null, `abilities[]`,
`note` (free-text caveat, or null; e.g. the Tal'darim Faction Card prints no resource).

**Mission** (`missions/{id}.json`): `id`, `name`, and `standard` / `skirmish`,
each `{ supply, supplyPerRound, gameLength, earlyWinLead, parameters, scoring, additional }`.

**Deployment**: `id`, `name`, `scale` (`standard` / `skirmish`), `description`
(the map described in words. There's no geometry data.)

**Glossary entry**: `id`, `term` (as shown, e.g. `"IMPACT (X) Y"`), `category`
(`keyword` / `status` / `rules` / `card` / `mission`), `definition` (a short
summary in our own words, not the rulebook's text), `rulesRef` (where to read the
official rule, e.g. `"Core Rules Part 11"`), `matches` (the exact, case-sensitive
words the app links to this entry in card text) and `seeAlso` (related ids).

**Scale**: `id`, `name`, `minerals`, `gas` (minerals ÷ 10), `custom` (true for
Grand Offensive, where `minerals` is only the default).

---

## Traps

1. **Stats are mixed types on purpose.** `speed` is a **string**, because it can
   be `"4/7"` (normal/run), and `armour` and `evade` are strings like `"5+"`.
   `hitPoints`, `size` and `shield` are numbers. Any stat a card prints as `-`
   is `null`: a Raven has `size: null`, a structure has `speed: null`, and
   Terran and Zerg units have `shield: null`.
2. **`earlyWinLead` can be null.** Artefact Hunt has no early-win condition.
3. **Cocoon's `resource` is null.** It's a passive card that supplies no BM
   (confirmed against the physical card, Nov 2026), so it can't be exhausted.
4. **Zagara's Broodmother upgrade costs `[0]`** because the cost table lists no
   cost for it, not because it's free. Its `note` says so.
5. **Legality isn't in the API.** The rules the app enforces (slot counts,
   Unique, Zerg needs exactly one Creep card (Stukov's Forces: one Virus card), `cannotBeTakenWith`, upgrades
   replacing the same weapon) live in `issues()` in `index.html`. Re-implement
   them if you need them.
6. **Weapon range `"Engagement"`** is the card's `E` (close combat).
7. **Spelling follows the cards**, mostly British (`Armour`), with a few
   card-printed oddities kept as-is (Pylon's combat tag is `Armored`).

---

## Quick checks from a shell

```bash
curl -s "https://sctmgdatadisc.com/api/v1/index.json"
```

```bash
curl -s "https://sctmgdatadisc.com/api/v1/units/zagara.json" | head -c 600
```

---

## Changing the API

- **Additive changes** (a new field, a new endpoint) are fine in `v1`.
- **Renaming or removing a field, or changing its type, needs `v2`**: write to
  `api/v2/` and keep `v1` building until anyone using it has moved.
- New data from an unofficial or approximate source gets `status` other than
  `"official"` or a `note`, the same transparency rule the app follows.
