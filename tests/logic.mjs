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

// ---------- 3. stale saved data ----------
{
  // A roster saved before an update that renamed or removed IDs must load
  // cleanly: totals() and issues() used to throw on an unknown ID.
  const stale = () => ({
    build: { ...build("T", "gone-faction", { barracks: 1, "gone-card": 2 }, ["marine", "gone-unit", { id: "marine", ci: 7, ups: ["Bayonet", "Gone Upgrade"] }]), name: "Old" },
    rosters: [{ ...build("Z", "zswarm", { acccreep: 1 }, ["zergling", "gone-unit"]), id: "r1", name: "Saved" }, null],
    setup: { rosterId: "r-missing", mission: "gone-mission", deploy: "", oppGas: "", oppMin: "" },
    game: null,
  });
  const s = stale();
  const notes = L.cleanState(s);
  check("stale roster: totals() no longer throws", (() => { try { L.totals(s.build); L.issues(s.build); return true; } catch { return false; } })());
  eq("stale roster: unknown faction cleared", s.build.faction, "");
  eq("stale roster: unknown card dropped, known kept", s.build.tac, { barracks: 1 });
  eq("stale roster: unknown unit dropped", s.build.units.map(u => u.id), ["marine", "marine"]);
  eq("stale roster: bad composition index reset", s.build.units[1].ci, 0);
  eq("stale roster: unknown upgrade dropped", s.build.units[1].ups, ["Bayonet"]);
  eq("saved rosters: junk entry dropped, unknown unit dropped", s.rosters.map(r => r.units.map(u => u.id)), [["zergling"]]);
  eq("setup: missing roster and mission reset", [s.setup.rosterId, s.setup.mission], ["current", ""]);
  eq("every removal is reported", notes.length, 5);
  check("notes name the missing IDs", ["gone-faction", "gone-card", "gone-unit", "Gone Upgrade"].every(id => notes.some(n => n.includes(id))), JSON.stringify(notes));

  const clean = { build: build("T", "rrf", { academy: 1 }, ["marine", "raynor"]), rosters: [], setup: {}, game: null };
  eq("a healthy save produces no notes", L.cleanState(clean), []);

  L.RENAMED["old-marine"] = "marine";
  const renamed = { build: build("T", "rrf", {}, ["old-marine"]), rosters: [], setup: {}, game: null };
  eq("RENAMED carries a roster across an ID rename", [L.cleanState(renamed), renamed.build.units[0].id], [[], "marine"]);
  delete L.RENAMED["old-marine"];

  const g = { build: L.newBuild("T"), rosters: [], setup: {}, game: { mission: "gone-mission", roster: L.newBuild("T"), units: [], cards: [], vp: [0, 0] } };
  L.cleanState(g);
  eq("a game whose mission vanished is cleared", g.game, null);
  const g2 = { build: L.newBuild("T"), rosters: [], setup: {}, game: { mission: "supplydrop", roster: L.newBuild("T"), units: [{ id: "marine" }, { id: "gone-unit" }], cards: [{ id: "taf", ready: true }, { id: "gone-card" }], vp: [3, 1] } };
  L.cleanState(g2);
  eq("a game keeps known units and cards", [g2.game.units.map(u => u.id), g2.game.cards.map(c => c.id), g2.game.vp], [["marine"], ["taf"], [3, 1]]);
}

// ---------- 4. glossary ----------
{
  const ids = new Set(), forms = new Map();
  for (const g of L.GLOSSARY) {
    check(`glossary "${g.id}": unique id`, !ids.has(g.id));
    ids.add(g.id);
    check(`glossary "${g.id}": has a name, definition and rules reference`, g.n && g.d && g.ref);
    check(`glossary "${g.id}": known category`, ["Keyword", "Status", "Rules", "Card", "Mission"].includes(g.cat), g.cat);
    for (const f of g.f) {
      check(`glossary form "${f}" belongs to one entry`, !forms.has(f), `${forms.get(f)} and ${g.id}`);
      forms.set(f, g.id);
    }
  }
  for (const g of L.GLOSSARY) for (const s of g.see) check(`glossary "${g.id}": see-also "${s}" exists`, ids.has(s));

  const link = s => L.linkTerms(L.esc(s));
  const linked = html => [...html.matchAll(/data-gl="([^"]+)">([^<]+)</g)].map(m => [m[1], m[2]]);
  eq("linker: keyword with a value", linked(link("resolve the IMPACT (2) effect")), [["impact", "IMPACT"]]);
  eq("linker: longest form wins", linked(link("set it Wholly Within 3″")), [["wholly-within", "Wholly Within"]]);
  eq("linker: each term once per paragraph", linked(link("Within 6″ and Within 3″")).length, 1);
  eq("linker: case-sensitive (lowercase prose isn't linked)", linked(link("the unit will run away")), []);
  eq("linker: whole words only", linked(link("TYPE PEACE HPX")), []);
  eq("linker: skips text inside existing tags", linked(L.linkTerms('<span title="Charge">x</span> Charge')), [["charge", "Charge"]]);
  check("linker: output is still escaped", !link('<b>"Charge"</b>').includes("<b>"));
}

// ---------- 5. every card keyword has a glossary entry ----------
{
  // Keywords are printed in BOLD CAPS on cards and weapons. Any caps word the
  // glossary can't link means a new keyword arrived (e.g. in a new wave) and
  // needs an entry. A few caps words on cards aren't rules terms; list them here.
  const NOT_TERMS = new Set([]); // none so far
  const texts = [];
  const weaponKw = w => w && w.kw && w.kw !== "-" && texts.push(w.kw);
  for (const u of L.UNITS) {
    (u.ab || []).forEach(a => texts.push(a.tx));
    (u.wp || []).forEach(weaponKw);
    (u.up || []).forEach(x => { if (x.tx) texts.push(x.tx); weaponKw(x.w); });
  }
  for (const t of L.TAC) (t.ab || []).forEach(a => texts.push(a.tx));
  for (const m of L.MISSIONS) for (const v of [m.std, m.sk]) texts.push(v.params, v.score, v.extra || "");
  const missing = new Map();
  for (const text of texts) {
    for (const [phrase] of String(text).matchAll(/\b[A-Z][A-Z'-]*[A-Z](?:\s+[A-Z][A-Z'-]*[A-Z])*\b/g)) {
      const leftover = L.linkTerms(L.esc(phrase)).replace(/<button[^>]*>[^<]*<\/button>/g, " ");
      for (const [w] of leftover.matchAll(/\b[A-Z][A-Z'-]*[A-Z]\b/g))
        if (!NOT_TERMS.has(w) && !/^[A-Z]-?\d/.test(w)) missing.set(w, (missing.get(w) || 0) + 1);
    }
  }
  check("every BOLD CAPS card keyword has a glossary entry", missing.size === 0,
    `no glossary entry links: ${[...missing].map(([w, n]) => `${w} (${n}×)`).join(", ")}`);
}

// ---------- 6. data integrity ----------
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
