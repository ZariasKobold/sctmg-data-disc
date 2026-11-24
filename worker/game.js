// Pure rules for the shared online-game state. No I/O, so tests/worker.mjs can
// run it in plain Node.
//
// Shape of a game state:
//   { mission, deploy, scale, len,            // set by the host, fixed
//     round, phase, over,                      // shared, changed by "step"
//     sides: { A: Side, B: Side|null } }       // A = host, B = guest
//   Side = { name, avatar, roster, units, cards, vp }
//
// Each player writes only their own side's units and cards (op "side"). Round,
// phase and VP are shared: either player can change them, and the server
// applies those as small ops so two quick taps can't overwrite each other.
// Card refreshes and activation resets at a new Phase/Round are done by each
// client on its own side when it sees the change (see the app's syncTransitions).

export const PHASES = 4;
export const other = (s) => (s === "A" ? "B" : "A");

export function newGameState({ mission, deploy, scale, len, host }) {
  return {
    mission, deploy: deploy || "", scale: scale === "sk" ? "sk" : "std", len,
    round: 1, phase: 0, over: false,
    sides: { A: { ...host, vp: 0 }, B: null },
  };
}

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const int = (v) => Number.isInteger(v);

// Apply one op from the player on `side`. Returns { state } or { error }.
// Never mutates the input.
export function applyOp(state, side, op) {
  if (!isObj(op) || typeof op.op !== "string") return { error: "Bad op" };
  const s = structuredClone(state);
  switch (op.op) {
    case "side": {
      // Replace my own units and cards (the opponent's are never touched).
      if (!Array.isArray(op.units) || !Array.isArray(op.cards)) return { error: "Bad side" };
      const me = s.sides[side];
      if (!me) return { error: "Not in this game" };
      me.units = op.units;
      me.cards = op.cards;
      return { state: s };
    }
    case "vp": {
      // Either player can adjust either score, like at the table.
      const who = op.side === "A" || op.side === "B" ? op.side : null;
      if (!who || !s.sides[who] || !int(op.d) || Math.abs(op.d) > 50) return { error: "Bad vp" };
      s.sides[who].vp = Math.max(0, (s.sides[who].vp || 0) + op.d);
      return { state: s };
    }
    case "step": {
      // Next/Back. `from` is the round and phase the tapping player saw, so a
      // double tap from both players only advances once.
      if (!isObj(op.from) || op.from.round !== s.round || op.from.phase !== s.phase) return { state: s, stale: true };
      if (op.dir === 1) {
        if (s.over) return { state: s, stale: true };
        if (s.phase < PHASES - 1) s.phase++;
        else if (s.round >= s.len) s.over = true;
        else { s.round++; s.phase = 0; }
      } else if (op.dir === -1) {
        if (s.phase > 0) s.phase--;
        else if (s.round > 1) { s.round--; s.phase = PHASES - 1; }
        s.over = false;
      } else return { error: "Bad step" };
      return { state: s };
    }
    default:
      return { error: "Unknown op" };
  }
}
