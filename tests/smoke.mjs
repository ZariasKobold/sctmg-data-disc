// Headless click-through of the real page: `node tests/smoke.mjs`.
// Needs Playwright (`npm install`, then `npx playwright install chromium`).
//
// For each race it builds a roster, saves it, runs Setup, plays a full game to
// the end, and opens and closes every card in the Cards tab. Any uncaught page
// error or console error fails the run.
//
// Gotcha: every click re-renders the view with innerHTML, so element handles go
// stale immediately. Always re-query (Playwright locators do this for us).

import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { INDEX } from "./load-app.mjs";

const HEADED = process.argv.includes("--headed");
const errors = [];
let step = "start";
const log = s => { step = s; if (process.env.VERBOSE) console.log("  " + s); };
function expect(ok, msg) { if (!ok) throw new Error(`${msg} (during: ${step})`); }

const browser = await chromium.launch({ headless: !HEADED });
const context = await browser.newContext({ viewport: { width: 400, height: 850 } });
const page = await context.newPage();

// Keep the run hermetic: answer Google Fonts with empty CSS instead of hitting the network.
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
page.on("console", m => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
page.on("dialog", d => d.accept()); // "Switching race clears…", "Replace the game…", etc.

const $ = s => page.locator(s);
const nav = v => $(`nav.tabs button[data-v="${v}"]`).click();
const fireChange = (sel, value) => $(sel).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); }, value);
// textContent, not innerText: innerText reports text as displayed, so CSS
// like text-transform:uppercase on headings would break these checks.
const text = sel => $(sel).textContent();
const modalOpen = () => $("#modal").evaluate(d => d.open);

try {
  await page.goto(pathToFileURL(INDEX).href);
  // Start from a clean slate even if a previous run left storage behind.
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  log("every view renders");
  for (const v of ["build", "setup", "play", "cards"]) {
    await nav(v);
    expect((await $(`#v-${v}`).innerHTML()).length > 100, `#v-${v} is empty`);
    expect(await $(`#v-${v}`).isVisible(), `#v-${v} isn't visible`);
  }

  // Data the page itself uses, so the test follows the cards as they change.
  const data = await page.evaluate(() => ({
    TAC: TAC.map(t => ({ id: t.id, r: t.r, type: t.type, tags: t.tags, res: !!t.res })),
    UNITS: UNITS.map(u => ({ id: u.id, r: u.r, sum: !!u.sum })),
  }));

  for (const race of ["T", "Z", "P"]) {
    // ---------- Build ----------
    log(`${race}: build`);
    await nav("build");
    await $('#v-build button#bNew').click();
    await $(`#v-build button[data-race="${race}"]`).click();
    expect(await page.evaluate(() => document.body.dataset.race) === race, "race accent didn't switch");

    const faction = data.TAC.find(t => t.r === race && t.type === "Faction" && t.tags.length === 1);
    await $("#bFac").selectOption(faction.id);
    await $("#bName").fill(`Smoke ${race}`);
    await $("#bName").dispatchEvent("change");

    // One Creep card for Zerg, plus two ordinary tactical cards for everyone.
    const pickTac = data.TAC.filter(t => t.r === race && t.tags.length === 1 && t.type === "Tactical").slice(0, 2);
    if (race === "Z") pickTac.push(data.TAC.find(t => t.r === "Z" && t.type === "Creep" && t.tags.length === 1));
    for (const t of pickTac) await $(`#v-build button[data-tq="${t.id}"][data-d="1"]`).click();

    for (let i = 0; i < 2; i++) {
      await $("#v-build details summary").click(); // re-render closes the picker each time
      await $("#v-build button[data-uadd]:not([disabled])").first().click();
    }
    expect(await $("#v-build button[data-urm]").count() === 2, "units didn't land in the roster");

    // Exercise the composition picker and an upgrade checkbox where the unit has them.
    if (await $("#v-build select[data-uci]").count()) await $("#v-build select[data-uci]").first().selectOption("1");
    if (await $("#v-build input[data-uup]").count()) await $("#v-build input[data-uup]").first().check();

    const issues = await text("#v-build .issues");
    expect(issues.includes("Roster is legal"), `sample roster should be legal, got: ${issues}`);

    await $("#v-build button[data-unit]").first().click();
    expect(await modalOpen(), "unit card modal didn't open from Build");
    await $("#mClose").click();
    expect(!(await modalOpen()), "modal didn't close");

    await $("#bSave").click();
    expect((await text("#v-build")).includes(`Smoke ${race}`), "saved roster isn't listed");

    // Save as new: the prompt is accepted with its default name, so a "(2)" copy appears
    // and later saves go to the copy, leaving the original alone.
    const savedCount = () => page.locator("#v-build button[data-rload]").count();
    const before = await savedCount();
    await $("#bSaveAs").click();
    expect((await savedCount()) === before + 1, "Save as new didn't add a roster");
    expect((await page.inputValue("#bName")) === `Smoke ${race} (2)`, "Save as new didn't switch to the copy");
    await $("#bSave").click();
    expect((await savedCount()) === before + 1, "Save after Save as new made another roster");

    // ---------- Setup ----------
    log(`${race}: setup`);
    await nav("setup");
    await $("#sMis").selectOption({ index: 1 });
    await $("#sDep").selectOption({ index: 1 });
    await fireChange("#sOG", "999");
    await fireChange("#sOM", "9999");
    expect((await text("#v-setup")).includes("You take priority"), "priority banner missing");
    await $("#v-setup button.gl").first().click(); // term links in the inline mission text
    expect(await page.evaluate(() => document.querySelector("#gloss").open), "term link in Setup didn't open");
    await $("#gClose").click();
    await $("#sStart").click();
    expect(await $("#v-play").isVisible(), "Start game didn't switch to Play");

    // ---------- Play ----------
    log(`${race}: play`);
    await $("#pMis").click();
    expect(await modalOpen(), "mission card didn't open");
    await $("#mClose").click();

    await $("#v-play button[data-dep]").first().click();
    expect((await text("#v-play")).includes("On the battlefield"), "deploy failed");
    await $("#v-play button[data-act]").first().click();
    await $('#v-play button[data-vp="0"][data-d="1"]').click();
    if (await $("#v-play button[data-card]").count()) {
      await $("#v-play button[data-card]").first().click();
      expect((await $("#v-play button[data-card]").first().innerText()) === "Ready", "card didn't exhaust");
    }
    await $('#v-play button[data-mod][data-d="-1"]').first().click();

    const summoned = data.UNITS.find(u => u.r === race && u.sum);
    if (summoned) {
      await $("#v-play details summary").click();
      await $(`#v-play button[data-sum="${summoned.id}"]`).click();
    }

    // Play to the end of the game; each round has four phases.
    for (let i = 0; i < 4 && !(await $("#pNext").isDisabled()); i++) await $("#pNext").click();
    expect((await text("#v-play .bigrow")).startsWith("2"), "didn't reach Round 2");
    if (await $("#v-play button[data-card]").count())
      expect((await $("#v-play button[data-card]").first().innerText()) === "Exhaust", "cards didn't refresh at end of round");
    await $("#pPrev").click(); // back across the round boundary
    for (let i = 0; i < 60 && !(await $("#pNext").isDisabled()); i++) await $("#pNext").click();
    expect((await text("#v-play")).includes("Game over"), "game never ended");
    await $("#pEnd").click();
    expect((await text("#v-play")).includes("No game running"), "game didn't clear");

    // ---------- Cards ----------
    log(`${race}: cards`);
    await nav("cards");
    await $(`#v-cards button[data-cr="${race}"]`).click();
    const n = await $("#v-cards button.pick").count();
    expect(n > 10, `only ${n} cards listed for ${race}`);
    for (let i = 0; i < n; i++) {
      step = `${race}: card ${i + 1}/${n}`;
      await $("#v-cards button.pick").nth(i).click();
      expect(await modalOpen(), "card modal didn't open");
      expect((await $("#mBody").innerHTML()).length > 20, "card modal is empty");
      await $("#mClose").click();
    }
  }

  log("cards search and theme toggle");
  await nav("cards");
  await $("#cQ").fill("Queen");
  await $('#v-cards button[data-cr="Z"]').click();
  expect((await text("#v-cards")).includes("Queen"), "search lost Queen");
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await $("#themeBtn").click();
  expect(before !== await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "theme toggle did nothing");

  log("glossary: term links in a card open a definition on top of the card");
  await nav("cards");
  await $("#cQ").fill("");
  await $('#v-cards button[data-cr="Z"]').click();
  await $('#v-cards button[data-unit="zergling"]').click();
  const terms = await $("#mBody button.gl").count();
  expect(terms > 10, `only ${terms} glossary links on the Zergling card`);
  await $('#mBody button.gl[data-gl="impact"]').click();
  expect(await page.evaluate(() => document.querySelector("#gloss").open && document.querySelector("#modal").open), "definition sheet should open over the still-open card");
  expect((await text("#gTitle")).startsWith("IMPACT"), "wrong term opened");
  await $('#gBody button.gl[data-gl="charge"]').first().click();
  expect((await text("#gTitle")) === "Charge" && await $("#gBack").isVisible(), "following a link inside a definition failed");
  await $("#gBack").click();
  expect((await text("#gTitle")).startsWith("IMPACT"), "Back didn't return to the previous term");
  await $("#gClose").click();
  expect(await modalOpen(), "closing the definition should leave the card open");
  await $("#mClose").click();

  log("glossary: weapon headers, stats and mission text link too");
  await $('#v-cards button[data-cr="T"]').click();
  await $('#v-cards button[data-unit="marine"]').click();
  for (const id of ["roa", "surge", "armour", "speed"]) expect(await $(`#mBody button.gl[data-gl="${id}"]`).count() > 0, `no "${id}" link on the Marine card`);
  await $("#mClose").click();
  await $("#v-cards button[data-mis]").first().click();
  expect(await $("#mBody button.gl").count() > 0, "mission text has no glossary links");
  await $("#mClose").click();

  log("glossary: tab, search, filters and every term opens");
  await nav("gloss");
  const total = await $("#v-gloss .gitem").count();
  expect(total > 100, `only ${total} glossary entries listed`);
  await $("#gQ").fill("engag");
  expect(await page.evaluate(() => document.activeElement.id) === "gQ", "search box lost focus while typing");
  expect((await $("#v-gloss .gitem h3").first().innerText()).startsWith("Engaged"), "best match isn't first");
  await $("#gQ").fill("zzzz");
  expect((await text("#gList")).includes("No matching terms"), "empty search state missing");
  await $("#gQ").fill("");
  await $('#v-gloss button[data-gc="Status"]').click();
  const statuses = await $("#v-gloss .gitem").count();
  expect(statuses > 3 && statuses < total, `Status filter shows ${statuses} of ${total}`);
  await $('#v-gloss button[data-gc=""]').click();
  const links = await $("#v-gloss button.gl").count();
  for (let i = 0; i < links; i += 7) { // a spread of links, not all 300+
    step = `glossary link ${i + 1}/${links}`;
    await $("#v-gloss button.gl").nth(i).click();
    expect((await $("#gBody").innerText()).length > 20, "definition sheet is empty");
    await $("#gClose").click();
  }

  log("saved rosters survive a reload");
  await page.reload();
  await nav("build");
  expect((await text("#v-build")).includes("Smoke P"), "rosters didn't persist");
  expect(!(await modalOpen()), "a healthy save shouldn't trigger the saved-data notice");
  expect(!(await $("#acctBtn").isVisible()), "the offline file has no server, so no Sign in button");

  log("export a Data Disc file, wipe rosters, import it back");
  // Export asks first: this roster (the primary button) or all saved rosters.
  await $("#bExport").click();
  expect(await modalOpen(), "Export didn't ask which rosters to export");
  const [single] = await Promise.all([page.waitForEvent("download"), $('[data-export="one"]').click()]);
  const oneFile = JSON.parse(await (await import("node:fs/promises")).readFile(await single.path(), "utf8"));
  expect(oneFile.rosters.length === 1 && !oneFile.current, "'This roster' exported more than one roster");
  await $("#bExport").click();
  const [download] = await Promise.all([page.waitForEvent("download"), $('[data-export="all"]').click()]);
  const file = await download.path();
  const savedN = await page.evaluate(() => st.rosters.length); // one per race, plus each race's "Save as new" copy
  await page.evaluate(() => { st.rosters = []; save(); renderBuild(); });
  expect(!(await text("#v-build")).includes("Smoke T"), "rosters weren't cleared");
  await $("#bFile").setInputFiles(file);
  await page.waitForFunction((n) => st.rosters.length === n, savedN);
  expect((await text("#v-build")).includes("Smoke T"), "imported rosters don't show");
  // Importing it again: the app lists the rosters it already has and asks.
  await $("#bFile").setInputFiles(file);
  await page.waitForSelector('[data-dupes="skip"]');
  expect((await text("#mBody")).includes("Smoke T"), "the already-saved prompt doesn't name the rosters");
  await $('[data-dupes="skip"]').click();
  expect(await page.evaluate(() => st.rosters.length) === savedN, "skipping already-saved rosters still added them");
  await $("#bFile").setInputFiles(file);
  await $('[data-dupes="new"]').click();
  expect(await page.evaluate((n) => st.rosters.length === n * 2 && new Set(st.rosters.map(r => r.id)).size === n * 2, savedN), "'Save as new' didn't add copies with their own IDs");
  await page.evaluate((n) => { st.rosters = st.rosters.slice(0, n); save(); renderBuild(); }, savedN); // back to one set for the paste check

  log("paste roster text");
  const pasted = await page.evaluate(() => rosterText(st.rosters[0]).replace(/^.*\n/, "Pasted army\n"));
  await $("#bPaste").click();
  await $("#pasteTxt").fill(pasted);
  await $("#pasteGo").click();
  expect(await page.evaluate((n) => st.build.name === "Pasted army" && st.rosters.length === n + 1, savedN), "pasted roster wasn't saved and loaded");
  expect(await page.evaluate(() => JSON.stringify(st.build.units.map(u => [u.id, u.ci, u.ups])) === JSON.stringify(st.rosters[0].units.map(u => [u.id, u.ci, u.ups]))), "pasted units differ from the original");

  log("a save with stale IDs loads with a notice instead of crashing");
  await page.evaluate(() => {
    const key = "sctmg-fieldkit-v1", s = JSON.parse(localStorage.getItem(key));
    s.build.faction = "gone-faction";
    s.build.units.push({ id: "gone-unit", ci: 0, ups: [] });
    s.game = { mission: "supplydrop", deploy: "", scale: "std", round: 1, phase: 0, vp: [0, 0], over: false, log: [],
      roster: s.build, units: [{ uid: 1, id: "gone-unit", ups: [], models: 1, max: 1, startSup: 1, status: "res" }], cards: [{ id: "gone-card", ready: true }] };
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.reload();
  expect(await modalOpen(), "stale-data notice didn't appear");
  expect((await $("#mBody").innerText()).includes("gone-unit"), "notice doesn't name the dropped unit");
  await $("#mClose").click();
  for (const v of ["build", "setup", "play"]) {
    await nav(v);
    expect((await $(`#v-${v}`).innerHTML()).length > 100, `#v-${v} is empty after loading stale data`);
  }
  await page.reload();
  expect(!(await modalOpen()), "the notice should only appear once (the cleaned save is written back)");
} catch (e) {
  errors.push(e.message);
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(`smoke: FAILED\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log("smoke: all views, three races, full game and every card OK");
