// Shared helper: pull the inline <script> out of index.html.
//
// The app is one file, so the tests (like scripts/build-api.mjs) read it as
// text. Everything above the UI HELPERS marker is pure data and logic with no
// DOM, so it can run in Node with a stubbed localStorage.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const INDEX = join(ROOT, "index.html");
const MARKER = "/* ===================== UI HELPERS";

export function appScript() {
  const html = readFileSync(INDEX, "utf8");
  const script = html.split("<script>")[1]?.split("</script>")[0];
  if (!script) throw new Error("index.html: couldn't find the inline <script>");
  return script;
}

// Evaluate the pure-logic half and hand back the names the tests need.
export function loadLogic() {
  const script = appScript();
  if (!script.includes(MARKER)) throw new Error("index.html: couldn't find the UI HELPERS marker");
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  const names = "UNITS,TAC,MISSIONS,DEPLOYS,SCALES,SLOT_TYPES,newBuild,limits,unitCost,totals,issues,curSupply,poolSupply,U,T,M,D,RENAMED,cleanBuild,cleanState,GLOSSARY,linkTerms,esc,rosterText,exportData,importData,parseRosterText,mergeRosters,freeRosterName,copyAsNew,asNewCopies,gameSide,gameFromRemote,applyRemoteState,otherSide";
  return new Function(script.split(MARKER)[0] + `;return {${names}};`)();
}
