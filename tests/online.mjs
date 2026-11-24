// Two-player online test against a real local Worker + D1: `node tests/online.mjs`.
// Needs `npm install` (Playwright + Wrangler) and `npx playwright install chromium`.
//
// Starts `wrangler dev` on a throwaway database with DEV_LOGIN on (localhost
// only, never in production), then drives three browser contexts:
//   alice1 + alice2 = the same account on two devices, bob = the opponent.
// Covers roster sync (save, delete), share links, hosting and joining with a
// code, and live updates of VP, phase/round, deployment and card exhausts.

import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./load-app.mjs";

const PORT = 8790, BASE = `http://localhost:${PORT}`;
const HEADED = process.argv.includes("--headed");
const errors = [];
let step = "start";
const log = (s) => { step = s; if (process.env.VERBOSE) console.log("  " + s); };
function expect(ok, msg) { if (!ok) throw new Error(`${msg} (during: ${step})`); }

const wranglerJs = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const persist = mkdtempSync(join(tmpdir(), "sdd-online-"));
const env = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" };
execSync(`"${process.execPath}" "${wranglerJs}" d1 migrations apply DB --local --persist-to "${persist}"`, { cwd: ROOT, env, stdio: "pipe" });
const server = spawn(process.execPath, [wranglerJs, "dev", "--port", String(PORT), "--persist-to", persist, "--var", "DEV_LOGIN:1", "--show-interactive-dev-session=false"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

function stopServer() {
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
    else server.kill("SIGTERM");
  } catch {}
}

let browser;
try {
  // Wait for the Worker to answer.
  for (let i = 0; ; i++) {
    try { const r = await fetch(`${BASE}/auth/me`); if (r.ok) break; } catch {}
    if (i > 90) throw new Error("wrangler dev didn't start:\n" + serverLog.slice(-2000));
    await new Promise((r) => setTimeout(r, 1000));
  }

  browser = await chromium.launch({ headless: !HEADED });
  async function player(name) {
    const context = await browser.newContext({ viewport: { width: 400, height: 850 } });
    const page = await context.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
    page.on("pageerror", (e) => errors.push(`${name} pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text() + (m.location().url || ""))) errors.push(`${name} console: ${m.text()}`); });
    page.on("dialog", (d) => d.accept());
    await page.goto(BASE + "/");
    await page.evaluate(() => localStorage.clear());
    const $ = (s) => page.locator(s);
    return { page, $, name,
      nav: (v) => $(`nav.tabs button[data-v="${v}"]`).click(),
      signIn: async () => { await page.goto(`${BASE}/auth/dev?name=${name}`); await page.waitForFunction(() => net.user); },
      until: (fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 15000 }).catch(() => { throw new Error(`${name}: timed out waiting for ${what} (during: ${step})`); }),
      st: (fn, arg) => page.evaluate(fn, arg),
    };
  }
  // A small Terran roster made through the app's own functions.
  const makeRoster = (p, rname) => p.st((rname) => {
    const b = newBuild("T"); b.name = rname; b.faction = "rrf"; b.tac = { barracks: 1 };
    UNITS.filter((u) => u.r === "T" && !u.sum && !u.uq).slice(0, 2).forEach((u) => b.units.push({ uid: ++uidc, id: u.id, ci: 0, ups: [], slot: u.slot }));
    st.build = b; save(); show("build");
  }, rname);

  const alice1 = await player("Alice"), alice2 = await player("Alice"), bob = await player("Bob");

  log("signed out: Sign in button shows, account sheet offers Discord");
  await alice1.until(() => !document.querySelector("#acctBtn").hidden, null, "Sign in button");
  await alice1.$("#acctBtn").click();
  expect((await alice1.$("#mBody").innerText()).includes("Sign in with Discord"), "account sheet has no Discord button");
  await alice1.$("#mClose").click();

  log("roster sync between two devices");
  await alice1.signIn();
  await makeRoster(alice1, "Alpha Squad");
  await alice1.$("#bSave").click();
  await alice2.signIn();
  await alice2.until(() => st.rosters.some((r) => r.name === "Alpha Squad"), null, "Alpha Squad to sync to the second device");
  await alice2.nav("build");
  expect((await alice2.$("#v-build").innerText()).includes("Alpha Squad"), "synced roster not listed");

  log("a delete on one device reaches the other");
  await makeRoster(alice2, "Doomed");
  await alice2.$("#bSave").click();
  await alice1.st(() => syncRosters());
  await alice1.until(() => st.rosters.some((r) => r.name === "Doomed"), null, "Doomed to arrive");
  const doomedId = await alice2.st(() => st.rosters.find((r) => r.name === "Doomed").id);
  await alice2.$(`#v-build button[data-rdel="${doomedId}"]`).click();
  await alice2.until(() => !Object.keys(st.tomb).length, null, "the delete to upload");
  await alice1.st(() => syncRosters());
  await alice1.until(() => !st.rosters.some((r) => r.name === "Doomed"), null, "Doomed to disappear");

  log("share link: Bob imports without signing in");
  await alice1.nav("build");
  const alphaId = await alice1.st(() => st.rosters.find((r) => r.name === "Alpha Squad").id);
  await alice1.page.evaluate(() => { navigator.share = undefined; });
  await alice1.$(`#v-build button[data-rshare="${alphaId}"]`).click();
  await alice1.until(() => document.querySelector("#shareLink"), null, "share link");
  const link = await alice1.$("#shareLink").inputValue();
  expect(/#share=[A-Z0-9]{8}$/.test(link), "bad share link " + link);
  await bob.page.goto(link);
  await bob.until(() => document.querySelector("[data-share-import]"), null, "share preview");
  expect((await bob.$("#mBody").innerText()).includes("Shared by Alice"), "share preview doesn't say who shared it");
  await bob.$("[data-share-import]").click();
  await bob.until(() => st.rosters.some((r) => r.name === "Alpha Squad"), null, "the shared roster");

  log("Alice hosts an online game");
  await bob.signIn();
  await alice1.page.reload(); await alice1.until(() => net.user, null, "session");
  await alice1.nav("setup");
  await alice1.$("#sRos").selectOption(alphaId);
  await alice1.$("#sMis").selectOption({ index: 1 });
  await alice1.until(() => document.querySelector("#sHost:not([disabled])"), null, "Host button");
  await alice1.$("#sHost").click();
  await alice1.until(() => st.game && st.game.online, null, "the hosted game");
  const code = await alice1.st(() => st.game.online.code);
  expect((await alice1.$("#v-play").innerText()).includes("Waiting for your opponent"), "host isn't told to wait");

  log("Bob joins with the code");
  await bob.nav("setup");
  const bobRoster = await bob.st(() => st.rosters[0].id);
  await bob.$("#sRos").selectOption(bobRoster);
  await bob.$("#sCode").fill(code.toLowerCase());
  await bob.$("#sJoin").click();
  await bob.until(() => st.game && st.game.online && st.game.opp, null, "joining");
  await alice1.until(() => st.game.opp && st.game.opp.name === "Bob", null, "Bob to appear for Alice");
  expect((await alice1.$("#v-play").innerText()).includes("Bob's army"), "opponent panel missing");

  log("VP: each player's changes reach the other");
  await bob.$('#v-play button[data-vp="0"][data-d="1"]').click();
  await alice1.until(() => st.game.vp[1] === 1, null, "Bob's VP");
  await alice1.$('#v-play button[data-vp="1"][data-d="1"]').click();
  await bob.until(() => st.game.vp[0] === 2, null, "Alice's point for Bob");
  await alice1.until(() => st.game.vp[1] === 2, null, "Alice's own view of Bob's VP");

  log("deploying, activating and exhausting reach the opponent");
  await bob.$("#v-play button[data-dep]").first().click();
  await alice1.until(() => st.game.opp.units.some((u) => u.status === "field"), null, "Bob's deployment");
  const card = await alice1.st(() => st.game.cards.findIndex((c) => T(c.id).res));
  expect(card >= 0, "no exhaustible card in Alice's roster");
  await alice1.$(`#v-play button[data-card="${card}"]`).click();
  await bob.until((i) => st.game.opp.cards[i].ready === false, card, "Alice's exhausted card");
  await bob.$("#v-play button[data-act]").first().click();
  await alice1.until(() => st.game.opp.units.some((u) => u.act), null, "Bob's activation");

  log("Next phase from one player moves both; activations reset");
  await alice1.$("#pNext").click();
  await bob.until(() => st.game.phase === 1, null, "phase 1");
  await bob.until(() => !st.game.units.some((u) => u.act), null, "Bob's activations to reset");
  await alice1.until(() => !st.game.opp.units.some((u) => u.act), null, "Alice to see Bob's reset");

  log("both tap Next at once: only one step");
  await Promise.all([alice1.$("#pNext").click(), bob.$("#pNext").click()]);
  await alice1.page.waitForTimeout(4000);
  const phases = [await alice1.st(() => st.game.phase), await bob.st(() => st.game.phase)];
  expect(phases[0] === 2 && phases[1] === 2, "double Next should advance once, got " + phases);

  log("new Round refreshes exhausted cards on both screens");
  await alice1.$("#pNext").click(); await alice1.until(() => st.game.phase === 3, null, "phase 3");
  await bob.until(() => st.game.phase === 3, null, "Bob phase 3");
  await bob.$("#pNext").click();
  await alice1.until(() => st.game.round === 2, null, "round 2");
  await alice1.until((i) => st.game.cards[i].ready, card, "Alice's card refresh");
  await bob.until((i) => st.game.opp.cards[i].ready, card, "Bob to see Alice's refreshed card");

  log("resume on a second device");
  await alice2.page.reload(); await alice2.until(() => net.user, null, "session");
  await alice2.nav("setup");
  await alice2.until((c) => document.querySelector(`[data-resume="${c}"]`), code, "game in the list");
  await alice2.$(`[data-resume="${code}"]`).click();
  await alice2.until(() => st.game && st.game.online && st.game.round === 2 && st.game.vp[1] === 2, null, "resumed state");

  log("ending the game reaches the opponent");
  await alice1.$("#pEnd").click();
  await bob.until(() => st.game.online.status === "ended", null, "ended status");
  expect((await bob.$("#v-play").innerText()).includes("was ended"), "Bob isn't told the game ended");

  log("account delete");
  await bob.$("#acctBtn").click();
  await bob.$("#mBody details summary").click();
  await bob.$('[data-acct="delete"]').click();
  await bob.until(() => !net.user, null, "signed out after delete");
  const me = await (await bob.page.request.get(`${BASE}/auth/me`)).json();
  expect(me.user === null, "session survived account delete");
} catch (e) {
  errors.push(e.message);
} finally {
  if (browser) await browser.close();
  stopServer();
  try { rmSync(persist, { recursive: true, force: true }); } catch {}
}

if (errors.length) {
  console.error(`online: FAILED\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log("online: sync, share, host/join and live play OK");
