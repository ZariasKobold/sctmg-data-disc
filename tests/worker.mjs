// Online-game rules in worker/game.js. Plain Node: `node tests/worker.mjs`.

import { applyOp, newGameState } from "../worker/game.js";

let failed = 0, passed = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else { failed++; console.error(`  FAIL ${name}\n       got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};

const fresh = () => {
  const s = newGameState({ mission: "hold", scale: "std", len: 2, host: { name: "Al", roster: {}, units: [{ uid: 1 }], cards: [] } });
  s.sides.B = { name: "Bo", roster: {}, units: [{ uid: 9 }], cards: [], vp: 0 };
  return s;
};
const step = (s, dir) => applyOp(s, "A", { op: "step", dir, from: { round: s.round, phase: s.phase } }).state;

{
  const s = fresh();
  const r = applyOp(s, "A", { op: "vp", side: "B", d: 3 });
  eq("vp: either player can score either side", r.state.sides.B.vp, 3);
  eq("vp: input is not mutated", s.sides.B.vp, 0);
  eq("vp: never below 0", applyOp(s, "B", { op: "vp", side: "A", d: -5 }).state.sides.A.vp, 0);
  eq("vp: silly delta refused", !!applyOp(s, "A", { op: "vp", side: "A", d: 1e9 }).error, true);
  eq("vp: bad side refused", !!applyOp(s, "A", { op: "vp", side: "C", d: 1 }).error, true);
}
{
  const s = fresh();
  const r = applyOp(s, "B", { op: "side", units: [{ uid: 9, act: true }], cards: [{ id: "x" }] });
  eq("side: writes only my own side", [r.state.sides.B.units[0].act, r.state.sides.A.units], [true, [{ uid: 1 }]]);
  eq("side: needs arrays", !!applyOp(s, "B", { op: "side", units: "x", cards: [] }).error, true);
  const solo = newGameState({ mission: "hold", scale: "std", len: 2, host: { name: "Al", units: [], cards: [] } });
  eq("side: guest can't write before joining", !!applyOp(solo, "B", { op: "side", units: [], cards: [] }).error, true);
}
{
  let s = fresh();
  const seen = [];
  for (let i = 0; i < 9; i++) { seen.push([s.round, s.phase, s.over]); s = step(s, 1); }
  eq("step: walks phases, then rounds, then ends", seen.slice(0, 5), [[1, 0, false], [1, 1, false], [1, 2, false], [1, 3, false], [2, 0, false]]);
  eq("step: ends after the last round", [s.round, s.phase, s.over], [2, 3, true]);
  s = step(s, -1);
  eq("step: Back from game over", [s.round, s.phase, s.over], [2, 2, false]);
  let t = fresh();
  const stale = applyOp(t, "B", { op: "step", dir: 1, from: { round: 1, phase: 2 } });
  eq("step: a tap based on an old view is ignored", [stale.stale, stale.state.phase], [true, 0]);
  t = step(t, 1);
  const again = applyOp(t, "B", { op: "step", dir: 1, from: { round: 1, phase: 0 } });
  eq("step: both players tapping Next only advances once", again.state.phase, 1);
  eq("step: Back at the very start stays put", [step(fresh(), -1).round, step(fresh(), -1).phase], [1, 0]);
}
eq("unknown op refused", !!applyOp(fresh(), "A", { op: "nuke" }).error, true);
eq("non-object op refused", !!applyOp(fresh(), "A", null).error, true);

console.log(`worker: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
