// Logic and data checks. No dependencies: `node tests/logic.mjs`.
//
// 1. Syntax: the whole inline script must compile (catches a stray brace that
//    would blank every tab).
// 2. Roster math: totals() and issues() against hand-checked rulebook cases.
// 3. Data integrity: IDs unique, references resolve, costs line up.

import { Script } from "node:vm";
import { appScript, loadLogic } from "./load-app.mjs";

let failed = 0, passed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++;
  else { failed++; console.error(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const has = (name, list, text) => check(name, list.some(x => x.includes(text)), `no issue containing "${text}" in ${JSON.stringify(list)}`);
const lacks = (name, list, text) => check(name, !list.some(x => x.includes(text)), `unexpected issue containing "${text}" in ${JSON.stringify(list)}`);

// ---------- 1. syntax ----------
try { new Script(appScript(), { filename: "index.html <script>" }); passed++; }
catch (e) { console.error(`  FAIL syntax: ${e.message}`); process.exit(1); }

let L;
try { L = loadLogic(); }
catch (e) { console.error(`  FAIL the data/logic half of the script throws when run: ${e.message}`); process.exit(1); }
const build = (race, faction, tac = {}, units = []) => {
  const b = L.newBuild(race);
  b.faction = faction;
  b.tac = tac;
  b.units = units.map(u => (typeof u === "string" ? { id: u, ci: 0, ups: [] } : { ci: 0, ups: [], ...u }));
  return b;
};

// ---------- 2. roster math ----------
{
  // The CLAUDE.md reference case.
  const b = build("T", "rrf", { barracks: 1, brxproxy: 1, factory: 1, orbital: 1, academy: 1, engbay: 1 });
  const t = L.totals(b);
  eq("RRF + six Terran cards: slots", t.avail, { Core: 8, Elite: 2, Support: 3, Air: 1, Hero: 1 });
  eq("RRF + six Terran cards: gas", t.gas, 30 + 40 + 35 + 25 + 40 + 25);
}
{
  const b = build("T", "rrf", { academy: 1 }, ["marine", "raynor", "medic"]);
  eq("legal Terran roster has no issues", L.issues(b), []);
  eq("legal Terran roster minerals", L.totals(b).min, 170 + 280 + 120);
}
{
  const b = L.newBuild("T");
  has("no faction is flagged", L.issues(b), "Pick a Faction Card");
}
{
  const b = build("T", "rrf", {}, ["raynor", "raynor"]);
  has("duplicate Unique is flagged", L.issues(b), "Raynor is Unique");
}
{
  const b = build("T", "novaops", {}, ["novastealth", "novaassault"]);
  has("Nova's two modes can't share an army", L.issues(b), "can't be in the same army");
}
{
  const b = build("T", "taf", {}, ["rrmarine"]);
  has("faction tag mismatch is flagged", L.issues(b), "needs the Raynor's Raiders tag");
}
{
  const b = build("T", "rrf", {}, ["marine", "marine", "marine", "marine"]);
  has("slot overflow is flagged", L.issues(b), "Core slots: using 4 of 3");
}
{
  const b = build("T", "rrf", {}, [{ id: "goliath", ups: ["Haywire Missiles", "Scatter Missiles"] }]);
  has("two upgrades replacing one weapon are flagged", L.issues(b), "both replace Hellfire Missiles");
}
{
  const b = build("T", "taf", {}, Array(6).fill({ id: "marine", ci: 1 }));
  b.scale = "sk";
  has("Skirmish mineral cap", L.issues(b), "Minerals over by 320");
  b.tac = { barracks: 2, brxproxy: 2 }; // 140 gas against Skirmish's 100
  has("Skirmish gas cap", L.issues(b), "Vespene Gas over by 40");
}
{
  // Upgrade cost follows the chosen composition: Bayonet is 20 for 6 Marines, 30 for 9.
  eq("upgrade cost, composition 0", L.unitCost({ id: "marine", ci: 0, ups: ["Bayonet"] }), 170 + 20);
  eq("upgrade cost, composition 1", L.unitCost({ id: "marine", ci: 1, ups: ["Bayonet"] }), 220 + 30);
}
{
  eq("Grand Offensive custom limits", L.limits({ scale: "go", goMin: 2500 }), { min: 2500, gas: 250 });
  eq("Standard limits", L.limits({ scale: "std" }), { min: 2000, gas: 200 });
}
{
  const noCreep = build("Z", "zswarm", {}, ["zergling"]);
  has("Zerg without a Creep card", L.issues(noCreep), "exactly one Creep Card");
  const oneCreep = build("Z", "zswarm", { acccreep: 1 }, ["zergling"]);
  lacks("Zerg with one Creep card", L.issues(oneCreep), "Creep Card");
  const twoCreep = build("Z", "kswarm", { acccreep: 1, malcreep: 1 }, ["zergling"]);
  has("Zerg with two Creep cards", L.issues(twoCreep), "exactly one Creep Card");
}
{
  // Supply by models alive: a 9-Marine squad is Supply 2, drops to 1 at 6 models, 0 at 3.
  const gu = n => ({ id: "marine", models: n, startSup: 2, ups: [] });
  eq("curSupply profile", [9, 7, 6, 4, 3, 0].map(n => L.curSupply(gu(n))), [2, 2, 1, 1, 0, 0]);
  eq("Advanced Medic Facilities units cost no pool Supply", L.poolSupply({ ...gu(9), ups: ["Advanced Medic Facilities"] }), 0);
}

// ---------- 3. data integrity ----------
{
  const ids = new Map();
  for (const x of [...L.UNITS, ...L.TAC, ...L.MISSIONS, ...L.DEPLOYS]) {
    check(`unique id "${x.id}"`, !ids.has(x.id), `also used by ${ids.get(x.id)}`);
    ids.set(x.id, x.n);
  }
  const factions = L.TAC.filter(t => t.type === "Faction");
  for (const u of L.UNITS) {
    check(`${u.id}: known race`, ["T", "Z", "P"].includes(u.r));
    for (const x of u.excl || []) check(`${u.id}: excl "${x}" exists`, !!L.U(x));
    if (u.sum) continue;
    check(`${u.id}: has compositions`, Array.isArray(u.comps) && u.comps.length > 0);
    check(`${u.id}: known slot`, L.SLOT_TYPES.includes(u.slot), `slot ${u.slot}`);
    check(`${u.id}: some faction can field it`, factions.some(f => f.r === u.r && u.tags.every(t => f.tags.includes(t))), `tags ${u.tags}`);
    if (!u.unk) check(`${u.id}: official card has abilities or weapons`, (u.ab || []).length + (u.wp || []).length > 0);
    for (const up of u.up || [])
      check(`${u.id}/${up.n}: one cost or one per composition`, up.c.length === 1 || up.c.length === u.comps.length, `${up.c.length} costs, ${u.comps.length} compositions`);
  }
  for (const t of L.TAC) {
    check(`${t.id}: known type`, ["Faction", "Tactical", "Creep"].includes(t.type), t.type);
    for (const s of Object.keys(t.slots || {})) check(`${t.id}: slot "${s}" is real`, L.SLOT_TYPES.includes(s));
    if (t.res) check(`${t.id}: resource is CP, BM or PE`, ["CP", "BM", "PE"].includes(t.res[0]) && t.res[1] > 0, JSON.stringify(t.res));
  }
  for (const r of ["T", "Z", "P"]) check(`race ${r} has a faction card`, factions.some(f => f.r === r));
  for (const m of L.MISSIONS)
    for (const side of ["std", "sk"]) {
      const v = m[side];
      check(`${m.id}.${side}: numbers`, [v.sup, v.esc, v.len].every(Number.isFinite), JSON.stringify([v.sup, v.esc, v.len]));
      check(`${m.id}.${side}: lead is a number or null`, v.lead === null || Number.isFinite(v.lead));
    }
  for (const d of L.DEPLOYS) check(`${d.id}: scale is std or sk`, ["std", "sk"].includes(d.sc));
}

console.log(`logic: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
