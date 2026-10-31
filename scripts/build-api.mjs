// Builds the static, read-only JSON API in api/v1/ from the data in index.html.
//
//   node scripts/build-api.mjs          write api/v1/
//   node scripts/build-api.mjs --check  exit 1 if api/v1/ is out of date (for CI)
//
// index.html stays the single source of truth. This script evaluates everything
// above the UI HELPERS marker (pure data and logic, no DOM) and reshapes the
// short internal keys into readable field names. See API.md for the contract.

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "api", "v1");
const CHECK = process.argv.includes("--check");

// ---------- load the app's data ----------
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const script = html.split("<script>")[1];
const marker = "/* ===================== UI HELPERS";
if (!script || !script.includes(marker)) throw new Error("index.html: couldn't find the inline script or the UI HELPERS marker");
globalThis.localStorage = { getItem: () => null, setItem() {} };
const D = new Function(script.split(marker)[0] + ";return {UNITS,TAC,MISSIONS,DEPLOYS,SCALES,LEGAL};")();

// ---------- reshape ----------
const RACE = { T: "terran", Z: "zerg", P: "protoss" };
const SCALE = { std: "standard", sk: "skirmish", go: "grand-offensive" };
const list = s => (s && s !== "-" ? s.split(",").map(x => x.trim()) : []);
const dash = v => (v === "-" ? null : v);

const ability = a => ({ phase: a.ph, name: a.n, kind: a.k, text: a.tx });
const weapon = w => ({
  phase: w.ph, name: w.n, range: w.rng === "E" ? "Engagement" : w.rng, target: w.t,
  rateOfAttack: w.roa, hit: w.hit, surgeType: list(w.su), surgeDice: dash(w.sd), damage: w.dmg, keywords: list(w.kw),
});

function unit(u) {
  const [shield, speed, armour, evade, hitPoints, size] = u.st || [];
  return {
    id: u.id, name: u.n, race: RACE[u.r], factionTags: u.tags,
    status: u.unk ? "cost-only" : "official",
    summoned: !!u.sum, unique: !!u.uq,
    armySlot: u.sum ? null : u.slot, combatRole: u.role || null, base: u.base || null,
    stats: u.st ? { shield: dash(shield), speed: dash(speed), armour: dash(armour), evade: dash(evade), hitPoints: dash(hitPoints), size: dash(size) } : null,
    combatTags: list(u.ct),
    supplyByModels: (u.prof || []).map(([min, max, supply]) => ({ min, max, supply })),
    compositions: u.sum ? [] : u.comps.map(([models, minerals, supply]) => ({ models, minerals, supply })),
    abilities: (u.ab || []).map(ability),
    weapons: (u.wp || []).map(weapon),
    upgrades: (u.up || []).map(x => ({
      name: x.n, cost: x.c, phase: x.ph || null, kind: x.k || null, text: x.tx || null,
      specialist: !!x.spec, replaces: x.rep || null, weapon: x.w ? weapon(x.w) : null,
    })),
    cannotBeTakenWith: u.excl || [],
    note: u.note || null,
  };
}

const card = t => ({
  id: t.id, name: t.n, race: RACE[t.r], type: t.type.toLowerCase(), factionTags: t.tags,
  status: t.unk ? "cost-only" : "official",
  unique: !!t.uq, gas: t.gas, armySlots: t.slots,
  resource: t.res ? { type: t.res[0], amount: t.res[1] } : null,
  abilities: (t.ab || []).map(ability),
});

const missionSide = s => ({
  supply: s.sup, supplyPerRound: s.esc, gameLength: s.len, earlyWinLead: s.lead,
  parameters: s.params, scoring: s.score, additional: s.extra || null,
});
const mission = m => ({ id: m.id, name: m.n, standard: missionSide(m.std), skirmish: missionSide(m.sk) });
const deployment = d => ({ id: d.id, name: d.n, scale: SCALE[d.sc], description: d.d });
const scales = Object.entries(D.SCALES).map(([k, s]) => ({ id: SCALE[k], name: s.n, minerals: s.min, gas: Math.floor(s.min / 10), custom: k === "go" }));

const units = D.UNITS.map(unit), cards = D.TAC.map(card);
const missions = D.MISSIONS.map(mission), deployments = D.DEPLOYS.map(deployment);

// ---------- envelope ----------
const dataVersion = createHash("sha256").update(JSON.stringify({ units, cards, missions, deployments, scales })).digest("hex").slice(0, 12);
const meta = {
  api: "v1", dataVersion, costs: "Cost table 09.10.2026", cards: "Official card sheets, waves 1–3 (v1.09.26)",
  docs: "https://github.com/zariaskobold/sctmg-data-disc/blob/main/API.md", legal: D.LEGAL,
};
const env = (data, extra) => ({ data, meta: extra ? { ...meta, ...extra } : meta });

const files = {
  "index.json": env({
    name: "SCTMG Data Disc API",
    base: "https://zariaskobold.github.io/sctmg-data-disc/api/v1/",
    endpoints: [
      "index.json", "units.json", "units/{id}.json", "cards.json", "cards/{id}.json",
      "missions.json", "missions/{id}.json", "deployments.json", "scales.json",
    ],
    counts: { units: units.length, cards: cards.length, missions: missions.length, deployments: deployments.length },
  }),
  "units.json": env(units, { count: units.length }),
  "cards.json": env(cards, { count: cards.length }),
  "missions.json": env(missions, { count: missions.length }),
  "deployments.json": env(deployments, { count: deployments.length }),
  "scales.json": env(scales, { count: scales.length }),
};
for (const u of units) files[`units/${u.id}.json`] = env(u);
for (const c of cards) files[`cards/${c.id}.json`] = env(c);
for (const m of missions) files[`missions/${m.id}.json`] = env(m);

// ---------- write or check ----------
const text = v => JSON.stringify(v, null, 1) + "\n";
const walk = d => existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]) : [];
const rel = p => relative(OUT, p).split("\\").join("/");

if (CHECK) {
  const have = new Set(walk(OUT).map(rel)), stale = [];
  for (const [p, v] of Object.entries(files)) {
    if (!have.has(p) || readFileSync(join(OUT, p), "utf8") !== text(v)) stale.push(p);
    have.delete(p);
  }
  stale.push(...[...have].map(p => p + " (no longer generated)"));
  if (stale.length) { console.error(`api/v1 is out of date. Run: node scripts/build-api.mjs\n  ${stale.join("\n  ")}`); process.exit(1); }
  console.log(`api/v1 is up to date (${Object.keys(files).length} files, data ${dataVersion}).`);
} else {
  rmSync(OUT, { recursive: true, force: true });
  for (const [p, v] of Object.entries(files)) { mkdirSync(dirname(join(OUT, p)), { recursive: true }); writeFileSync(join(OUT, p), text(v)); }
  console.log(`Wrote ${Object.keys(files).length} files to api/v1 (data ${dataVersion}).`);
}
