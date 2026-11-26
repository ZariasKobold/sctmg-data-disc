// Renders the app icons from one SVG design: `node scripts/build-icons.mjs`.
// Needs Playwright (dev dependency). Output goes to icons/ and is committed,
// so the site itself never needs this script.
//
// The design: a data disc ringed in the three race colours (Terran blue,
// Zerg purple, Protoss gold) on the dark-theme navy.
//   icons/icon.svg           rounded square, used as the favicon
//   icons/icon-192/512.png   rounded square ("any" in the manifest)
//   icons/maskable-512.png   full-bleed square, art inside the 80% safe zone
//   icons/apple-touch-icon.png  180px full-bleed (iOS rounds it itself)
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../tests/load-app.mjs";

const NAVY = "#0E1A2B", T = "#4A95E6", Z = "#AE6BE0", P = "#E3B23C";

// scale shrinks the disc (maskable icons must keep art in the middle 80%).
function svg({ rounded, scale = 1 }) {
  const r = 150, c = 2 * Math.PI * r, seg = c / 3, gap = c * (16 / 360);
  const arc = (color, i) =>
    `<circle cx="256" cy="256" r="${r}" fill="none" stroke="${color}" stroke-width="34" ` +
    `stroke-dasharray="${(seg - gap).toFixed(2)} ${(c - seg + gap).toFixed(2)}" ` +
    `transform="rotate(${-90 + i * 120 + 8} 256 256)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" ${rounded ? 'rx="104"' : ""} fill="${NAVY}"/>
<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
<circle cx="256" cy="256" r="186" fill="#162740"/>
${arc(T, 0)}${arc(Z, 1)}${arc(P, 2)}
<circle cx="256" cy="256" r="96" fill="#1C3150"/>
<circle cx="256" cy="256" r="96" fill="none" stroke="#2B4468" stroke-width="6"/>
<circle cx="256" cy="256" r="30" fill="${NAVY}"/>
</g>
</svg>
`;
}

const out = (f) => join(ROOT, "icons", f);
const rounded = svg({ rounded: true }), full = svg({ rounded: false, scale: 0.86 }), mask = svg({ rounded: false, scale: 1.05 });
writeFileSync(out("icon.svg"), rounded);

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(markup, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`);
  await page.screenshot({ path: out(file), omitBackground: true });
}
await png(rounded, 192, "icon-192.png");
await png(rounded, 512, "icon-512.png");
await png(mask, 512, "maskable-512.png");
await png(full, 180, "apple-touch-icon.png");
await browser.close();
console.log("icons: wrote icon.svg, icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png");
