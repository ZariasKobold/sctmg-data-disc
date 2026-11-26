// Logic and data checks. No dependencies: `node tests/logic.mjs`.
//
// 1. Syntax: the whole inline script must compile (catches a stray brace that
//    would blank every tab).
// 2. Roster math: totals() and issues() against hand-checked rulebook cases.
// 3. Stale saved data, 4-5. glossary, 6. data integrity.
// 7. Roster files and pasted text, 8. roster sync merge, 9. online game bookkeeping.

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
  // Stukov's Forces (Wave 4) takes one Virus card instead of a Creep card.
  const noVirus = build("Z", "stukovforces", {}, ["infmarine"]);
  has("Stukov without a Virus card", L.issues(noVirus), "exactly one Virus Card");
  const oneVirus = build("Z", "stukovforces", { hungerinf: 1 }, ["infmarine", "infgoliath", "stukov"]);
  lacks("Stukov with one Virus card", L.issues(oneVirus), "Virus Card");
  check("Stukov legal army has no issues", L.issues(oneVirus).length === 0, L.issues(oneVirus).join(" | "));
  const creepStukov = build("Z", "stukovforces", { hungerinf: 1, acccreep: 1 }, ["infmarine"]);
  has("Stukov with a Creep card", L.issues(creepStukov), "not a Creep Card");
  const virusSwarm = build("Z", "zswarm", { acccreep: 1, healpathogen: 1 }, ["zergling"]);
  has("Zerg Swarm with a Virus card", L.issues(virusSwarm), "isn't allowed with this Faction Card");
  const tankSwarm = build("Z", "kswarm", { acccreep: 1 }, ["infsiegetank"]);
  has("Infested Siege Tank outside Stukov", L.issues(tankSwarm), "Stukov's Forces");
  // Wave 4 Terran: Barracks (Reactor) gives 3 Core, so TAF (3 Core) fits 6 Core of Firebats (3 units x Supply 2 at 6 models).
  const fire = build("T", "taf", { brxreactor: 1 }, [{ id: "firebat", ci: 1 }, { id: "firebat", ci: 1 }, { id: "firebat", ci: 1 }]);
  lacks("Firebats fit Barracks (Reactor) Core slots", L.issues(fire), "Core slots");
  eq("Firebat 4 models with both upgrades", L.unitCost({ id: "firebat", ci: 0, ups: ["Incinerator Gauntlets", "Need A Light?"] }), 160 + 40);
  // Wave 4 Protoss: Tal'darim (1 Elite) + Robotics Support Bay (2 Elite) fits a Slayer (Supply 1) and a Reaver (Supply 2).
  const tal = build("P", "taldarim", { robobay: 1 }, ["alarak", "slayer", "reaver"]);
  check("Tal'darim legal army has no issues", L.issues(tal).length === 0, L.issues(tal).join(" | "));
  const slayerKhalai = build("P", "khalai", {}, ["slayer"]);
  has("Slayer outside Tal'darim", L.issues(slayerKhalai), "Tal'darim");
  check("Infested Goliath copies the Terran Goliath", JSON.stringify(L.U("infgoliath").wp) === JSON.stringify(L.U("goliath").wp) && L.U("infgoliath").ct.includes("Infested"));
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
    check(`${t.id}: known type`, ["Faction", "Tactical", "Creep", "Virus"].includes(t.type), t.type);
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

// ---------- 7. roster files and pasted text ----------
{
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const strip = (b) => ({ name: b.name, race: b.race, scale: b.scale, faction: b.faction, tac: b.tac,
    units: b.units.map((u) => [u.id, u.ci, [...u.ups].sort()]), missions: b.missions, deps: b.deps });

  // Every unit, at every squad size, with every upgrade, survives Copy as text -> Paste text.
  for (const race of ["T", "Z", "P"]) {
    const units = L.UNITS.filter((u) => u.r === race && !u.sum);
    const b = L.newBuild(race);
    b.name = `Round trip ${race}`;
    b.faction = L.TAC.find((t) => t.r === race && t.type === "Faction").id;
    L.TAC.filter((t) => t.r === race && t.type !== "Faction").forEach((t, i) => (b.tac[t.id] = t.uq ? 1 : 1 + (i % 2)));
    b.missions = L.MISSIONS.slice(0, 2).map((m) => m.id);
    b.deps = L.DEPLOYS.filter((d) => d.sc === "std").slice(0, 2).map((d) => d.id);
    units.forEach((u) => u.comps.forEach((c, ci) => b.units.push({ uid: 1, id: u.id, ci, ups: u.up.map((x) => x.n), slot: u.slot })));
    const { build: back, notes } = L.parseRosterText(L.rosterText(b));
    eq(`paste text ${race}: no unmatched lines`, notes, []);
    // A unit whose squad sizes repeat (same model count twice) can't be told apart by text; skip those.
    const ambiguous = new Set(units.filter((u) => new Set(u.comps.map((c) => c[0])).size !== u.comps.length).map((u) => u.id));
    const keep = (x) => ({ ...x, units: x.units.filter(([id]) => !ambiguous.has(id)) });
    eq(`paste text ${race}: round trip`, keep(strip(back)), keep(strip(b)));
  }
  {
    const { build, notes } = L.parseRosterText("Friends list\n• Marine x5\nTerran - (no faction) - Skirmish\nUNITS\n* marine X5 (whatever) — combat shield, Laser Sight 9000\n- Ultralisk\nTACTICAL CARDS\n- barracks\nMISSIONS: Nope");
    eq("paste text: lenient race line and scale", [build.race, build.scale, build.faction], ["T", "sk", ""]);
    eq("paste text: units matched case-insensitively", build.units.map((u) => u.id), ["marine"]);
    has("paste text: unknown upgrade reported", notes, "Laser Sight 9000");
    has("paste text: other race's unit reported", notes, "Ultralisk");
    has("paste text: unknown mission reported", notes, "Nope");
    eq("paste text: card matched", build.tac, { barracks: 1 });
    eq("paste text: no race line", L.parseRosterText("hello").build, null);
  }

  // Data Disc file import.
  const st = { build: L.newBuild("Z"), rosters: [] };
  const a = L.newBuild("T"); a.id = "rA"; a.name = "Alpha"; a.units = [{ uid: 1, id: "marine", ci: 0, ups: [] }];
  const z = L.newBuild("Z"); z.id = "rZ"; z.name = "Zed"; z.units = [{ uid: 2, id: "zergling", ci: 0, ups: [] }, { uid: 3, id: "gone_unit", ci: 0, ups: [] }];
  st.rosters = [a, z];
  const file = clone(L.exportData(st));
  eq("export: format tag", [file.format, file.version, file.rosters.length], ["sctmg-data-disc", 1, 2]);
  let r = L.importData(file, []);
  eq("import into empty: both rosters", r.rosters.map((x) => x.name), ["Alpha", "Zed"]);
  has("import: unknown unit reported", r.notes, "gone_unit");
  r = L.importData(clone(file), [clone(a)]);
  eq("import: identical roster skipped", [r.skipped, r.rosters.map((x) => x.name)], [1, ["Zed"]]);
  eq("import: the skipped roster is offered back as a dupe", r.dupes.map((x) => x.name), ["Alpha"]);
  const copies = L.asNewCopies([r.dupes[0], r.dupes[0]], [a, z]);
  check("import: dupes saved as new get fresh ids and distinct names", copies.every((c) => c.id !== "rA") && copies[0].id !== copies[1].id && JSON.stringify(copies.map((c) => c.name)) === JSON.stringify(["Alpha (2)", "Alpha (3)"]));
  const one = clone(L.exportData(st, a));
  eq("export one: just that roster, no current build", [one.rosters.map((x) => x.name), one.current], [["Alpha"], undefined]);
  const a2 = clone(a); a2.name = "Alpha v2";
  r = L.importData([a2], [clone(a)]);
  check("import: same id but different content gets a fresh id", r.rosters.length === 1 && r.rosters[0].id !== "rA" && r.rosters[0].name === "Alpha v2");
  eq("import: a bare roster works", L.importData(clone(a), []).rosters.length, 1);
  eq("import: junk gives a note, not a crash", L.importData({ hello: 1 }, []).rosters, []);
  eq("import: null is safe", L.importData(null, []).rosters, []);
  const evil = clone(a); evil.id = "../../x"; evil.name = "<b>x</b>".repeat(30);
  r = L.importData([evil], []);
  check("import: unsafe id replaced, long name trimmed", /^r[a-z0-9]+$/.test(r.rosters[0].id) && r.rosters[0].name.length <= 80);
}

// ---------- 8. roster sync merge ----------
{
  const R = (id, updated, name = id) => ({ id, updated, name });
  const W = (id, updated, name = id, deleted = false) => ({ id, updated, deleted, data: deleted ? null : R(id, updated, name) });
  let m = L.mergeRosters([R("a", 5)], {}, []);
  eq("sync: local-only roster is uploaded", [m.rosters.map((x) => x.id), m.push.map((x) => x.id)], [["a"], ["a"]]);
  m = L.mergeRosters([], {}, [W("b", 3)]);
  eq("sync: remote-only roster is downloaded", [m.rosters.map((x) => x.id), m.changed], [["b"], true]);
  m = L.mergeRosters([R("a", 5, "new")], {}, [W("a", 3, "old")]);
  eq("sync: newer local wins and uploads", [m.rosters[0].name, m.push.length], ["new", 1]);
  m = L.mergeRosters([R("a", 3, "old")], {}, [W("a", 5, "new")]);
  eq("sync: newer remote wins", [m.rosters[0].name, m.push.length], ["new", 0]);
  m = L.mergeRosters([R("a", 3)], {}, [W("a", 5, "a", true)]);
  eq("sync: deleted on another device after my edit: removed here", m.rosters, []);
  m = L.mergeRosters([R("a", 9)], {}, [W("a", 5, "a", true)]);
  eq("sync: edited here after the delete: kept and re-uploaded", [m.rosters.length, m.push.length], [1, 1]);
  m = L.mergeRosters([], { b: 10 }, [W("b", 3)]);
  eq("sync: deleted here: not re-downloaded, delete is sent", [m.rosters, m.drop], [[], ["b"]]);
  m = L.mergeRosters([], { b: 10 }, [W("b", 20, "edited")]);
  eq("sync: edited elsewhere after my delete: comes back", [m.rosters.map((x) => x.name), m.drop], [["edited"], []]);
  m = L.mergeRosters([], { c: 10 }, []);
  eq("sync: delete of a never-synced roster still sent (harmless)", m.drop, ["c"]);
}

// ---------- 8b. save as new ----------
{
  const saved = [{ name: "Raiders" }, { name: "Raiders (2)" }, { name: "Swarm" }];
  eq("save as: unused name kept", L.freeRosterName("2000 list", saved), "2000 list");
  eq("save as: taken name gets the next number", L.freeRosterName("Raiders", saved), "Raiders (3)");
  eq("save as: numbered name counts from its base", L.freeRosterName("Raiders (2)", saved), "Raiders (3)");
  eq("save as: blank name falls back", L.freeRosterName("  ", []), "New army");
  const b = L.newBuild("T"); b.units = [{ id: "marine", ci: 0, ups: [] }];
  const c = L.copyAsNew(b, " Raiders 2000 ");
  check("save as: copy gets a new id and the new name", c.id !== b.id && c.name === "Raiders 2000" && c.updated > 0);
  c.units.push({ id: "marine", ci: 0, ups: [] });
  eq("save as: copy is deep (original untouched)", b.units.length, 1);
}

// ---------- 9. online game bookkeeping ----------
{
  const b = L.newBuild("T"); b.faction = "rrf"; b.tac = { barracks: 1 }; b.units = [{ id: "marine", ci: 0, ups: [] }, { id: "marauder", ci: 0, ups: [] }];
  const side = L.gameSide(b);
  eq("gameSide: cards", side.cards.map((c) => c.id), ["rrf", "barracks"]);
  eq("gameSide: units start in Reserves", side.units.map((u) => u.status), ["res", "res"]);
  const state = (round, phase, mine, extra = {}) => ({
    mission: "hold", deploy: "", scale: "std", len: 5, round, phase, over: false,
    sides: { A: { name: "Al", roster: b, units: mine.units, cards: mine.cards, vp: 2 }, B: { name: "Bo", roster: b, units: [], cards: [], vp: 1 } }, ...extra,
  });
  const res = (v, s) => ({ code: "ABC234", side: "A", v, status: "active", state: s });
  const g = L.gameFromRemote(res(1, state(1, 0, side)));
  eq("gameFromRemote: my VP first", g.vp, [2, 1]);
  eq("gameFromRemote: opponent kept", g.opp.name, "Bo");
  g.units[0].status = "field"; g.units[0].act = true; g.cards[1].ready = false;
  const mine = JSON.parse(JSON.stringify({ units: g.units, cards: g.cards }));
  check("phase forward: tells caller to upload my side", L.applyRemoteState(g, res(2, state(1, 1, mine)), false) === true);
  eq("phase forward: activations reset, cards stay exhausted", [g.units[0].act, g.cards[1].ready], [false, false]);
  g.units[0].models = 3;
  L.applyRemoteState(g, res(3, state(2, 0, { units: g.units, cards: g.cards })), true);
  eq("new round: cards refresh, Supply snapshot taken", [g.cards[1].ready, g.units[0].snap], [true, L.curSupply(g.units[0])]);
  check("same step again: nothing to upload", L.applyRemoteState(g, res(4, state(2, 0, { units: g.units, cards: g.cards })), true) === false);
  g.cards[1].ready = false;
  L.applyRemoteState(g, res(5, state(1, 3, { units: g.units, cards: g.cards })), true);
  eq("Back: no refresh", g.cards[1].ready, false);
  const keep = JSON.stringify(g.units);
  L.applyRemoteState(g, res(6, state(1, 3, { units: [], cards: [] })), true);
  eq("keepMine: unsent local edits are not overwritten", JSON.stringify(g.units), keep);
}

console.log(`logic: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
