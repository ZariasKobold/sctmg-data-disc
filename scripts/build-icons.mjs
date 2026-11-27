// Renders the app icons and header logo from Dalton's source art:
//   node scripts/build-icons.mjs
// Needs sharp (dev dependency). Output goes to icons/ and is committed,
// so the site itself never needs this script.
//
// Sources (full size, kept in art/, which is not published):
//   art/data-disc-icon.png  1254px square: the chip in a ring, inside a blue
//                           rounded-square frame on black
//   art/sctmg-logo.png      2172x724 wordmark banner on near-black
//
// Outputs:
//   icons/icon-192/512.png     the framed icon, black corners cut away
//                              ("any" in the manifest)
//   icons/maskable-512.png     full-bleed: ring + chip only, inside the 80%
//                              safe zone (Android cuts its own shape)
//   icons/apple-touch-icon.png 180px, cropped to the frame (iOS rounds it)
//   icons/favicon-64.png       browser tab icon
//   icons/logo.webp            header logo, trimmed, 3x for sharp phones
import sharp from "sharp";
import { join } from "node:path";
import { ROOT } from "../tests/load-app.mjs";

const SRC = join(ROOT, "art", "data-disc-icon.png");
const LOGO = join(ROOT, "art", "sctmg-logo.png");
const out = (f) => join(ROOT, "icons", f);

// Measured on the source: the frame's outer edge sits 43px in, and its
// corners have a radius of about 330px. The inside of the frame is #020A19.
const N = 1254, INSET = 40, RADIUS = 333, INNER_BG = { r: 2, g: 10, b: 25 };

const svgBuf = (s) => Buffer.from(s);
const roundedMask = svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}">
<rect x="${INSET}" y="${INSET}" width="${N - 2 * INSET}" height="${N - 2 * INSET}" rx="${RADIUS}" fill="#fff"/></svg>`);

// Framed icon with transparent corners, at full size.
const framed = await sharp(SRC).ensureAlpha()
  .composite([{ input: roundedMask, blend: "dest-in" }])
  .png().toBuffer();

for (const size of [192, 512]) {
  await sharp(framed).resize(size, size).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(out(`icon-${size}.png`));
}
await sharp(framed).resize(64, 64).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(out("favicon-64.png"));

// Apple: crop just inside the black corners; iOS applies its own rounding.
const c = 43;
await sharp(SRC).extract({ left: c, top: c, width: N - 2 * c, height: N - 2 * c })
  .resize(180, 180).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(out("apple-touch-icon.png"));

// Maskable: keep a soft-edged circle around the ring and chip (radius 520
// of 1254), drop the frame, and centre it on the inner navy so it fills
// 80% of the canvas.
const R = 520;
const circle = svgBuf(`<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}">
<defs><radialGradient id="g"><stop offset="0.94" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<circle cx="${N / 2}" cy="${N / 2}" r="${R}" fill="url(#g)"/></svg>`);
// (Two steps: sharp always runs extract before composite within one pipeline.)
const cut = await sharp(SRC).ensureAlpha()
  .composite([{ input: circle, blend: "dest-in" }]).png().toBuffer();
const disc = await sharp(cut)
  .extract({ left: N / 2 - R, top: N / 2 - R, width: 2 * R, height: 2 * R })
  .resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 3, background: INNER_BG } })
  .composite([{ input: disc, gravity: "center" }])
  .png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(out("maskable-512.png"));

// Logo: cut the background to transparent, trim, then size for a ~40px-tall
// header slot at 3x.
//
// The dark plate behind the lettering is the same near-black as the
// background, so we can't just key out a colour. Instead: mark everything
// that isn't background-coloured, thicken those strokes for a moment so the
// gaps in the ring are closed, flood-fill the background in from the edges,
// and make only that outside region transparent. Edge pixels keep partial
// alpha (with the black un-blended from their colour) so the outline stays
// smooth on light backgrounds too.
async function cutBackground(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info, n = W * H;
  const bg = [data[0], data[1], data[2]];               // top-left pixel
  const FULL = 60, GROW = 24;                           // diff for fully opaque; gap-closing radius
  const diff = new Float32Array(n), solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.max(Math.abs(data[3 * i] - bg[0]), Math.abs(data[3 * i + 1] - bg[1]), Math.abs(data[3 * i + 2] - bg[2]));
    diff[i] = d; solid[i] = d > 30 ? 1 : 0;
  }
  // Square dilation, done as a horizontal then a vertical pass.
  const dilate = (m, r) => {
    const a = new Uint8Array(n), b = new Uint8Array(n);
    for (let y = 0; y < H; y++) for (let x = 0, last = -1e9; x < W; x++) { if (m[y * W + x]) last = x; a[y * W + x] = x - last <= r ? 1 : 0; }
    for (let y = 0; y < H; y++) for (let x = W - 1, last = 1e9; x >= 0; x--) { if (m[y * W + x]) last = x; if (last - x <= r) a[y * W + x] = 1; }
    for (let x = 0; x < W; x++) for (let y = 0, last = -1e9; y < H; y++) { if (a[y * W + x]) last = y; b[y * W + x] = y - last <= r ? 1 : 0; }
    for (let x = 0; x < W; x++) for (let y = H - 1, last = 1e9; y >= 0; y--) { if (a[y * W + x]) last = y; if (last - y <= r) b[y * W + x] = 1; }
    return b;
  };
  const wall = dilate(solid, GROW);
  // Flood-fill the outside from every edge pixel.
  const out = new Uint8Array(n), stack = [];
  const push = (i) => { if (!out[i] && !wall[i]) { out[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop(), x = i % W;
    if (x > 0) push(i - 1); if (x < W - 1) push(i + 1);
    if (i >= W) push(i - W); if (i < n - W) push(i + W);
  }
  // Grow the outside back up to the strokes (it stopped GROW px short).
  const near = dilate(out, GROW + 1);
  const rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    let a = 1;
    if (near[i] && !solid[i]) a = 0;                     // background
    else if (near[i]) a = Math.min(1, diff[i] / FULL);   // anti-aliased edge
    for (let c = 0; c < 3; c++) {
      const v = data[3 * i + c];
      rgba[4 * i + c] = a > 0 && a < 1 ? Math.max(0, Math.min(255, Math.round((v - bg[c] * (1 - a)) / a))) : v;
    }
    rgba[4 * i + 3] = Math.round(a * 255);
  }
  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}
const cutout = await cutBackground(LOGO);
const trimmed = await sharp(cutout).trim({ threshold: 10 }).toBuffer();
const logo = await sharp(trimmed).resize({ height: 120 }).webp({ quality: 88, alphaQuality: 100 }).toFile(out("logo.webp"));

console.log(`icons: wrote icon-192/512.png, maskable-512.png, apple-touch-icon.png, favicon-64.png, logo.webp (${logo.width}x${logo.height})`);
