// Generates every PWA raster asset from one vector source.
//
// RestroSewa's brand is a TEXT wordmark — there has never been an app icon, and a
// wordmark is illegible at 48px anyway. So the mark drawn here is a serving cloche
// on the brand purple: it survives being shrunk to a launcher icon, and it needs no
// font, which matters because rasterising text through libvips depends on fontconfig
// and would not render the same on every machine that runs this script.
//
// Everything is committed to public/, so this is a one-shot generator, not part of
// the build. Re-run it only when the mark or the device list changes:
//
//     node scripts/generate-pwa-assets.mjs
//
// sharp comes in with Next (it powers next/image), so there is no new dependency.

import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");

const BRAND = "#533afd"; // --color-primary
const CANVAS = "#f6f9fc"; // --color-canvas-soft — the app's own background

// The mark, authored in a 512×512 box. Deliberately drawn as paths rather than
// text so it rasterises identically everywhere.
const glyph = (color) => `
  <g fill="${color}">
    <rect x="112" y="310" width="288" height="26" rx="13"/>
    <path d="M150 310 A106 106 0 0 1 362 310 Z"/>
    <rect x="250" y="196" width="12" height="16" rx="6"/>
    <circle cx="256" cy="190" r="15"/>
  </g>`;

// The drawing above is inset within its 512 box — the art itself only spans
// x 112–400, y 176–336 — so `scale` is relative to the BOX, not to the ink. A
// scale above 1 is therefore normal and still leaves the mark inside the field;
// it just stops the cloche from swimming in a sea of purple.
const ART_W = 288 / 512; // 0.5625 — how much of the box the ink actually covers
// Furthest the ink reaches from the centre of the box, as a fraction of the edge.
// This is what has to stay inside a maskable icon's safe circle.
const ART_R = Math.hypot(144, 80) / 512; // 0.3216

/**
 * @param size    edge length in px
 * @param bg      field colour, or null for a transparent field
 * @param fg      glyph colour
 * @param scale   fraction of the edge the 512-box is mapped onto
 * @param radius  corner radius as a fraction of the edge (0 = square)
 */
function icon({ size, bg, fg, scale, radius }) {
  const s = (size * scale) / 512;
  const off = (size * (1 - scale)) / 2;
  const field = bg
    ? `<rect width="${size}" height="${size}" rx="${size * radius}" fill="${bg}"/>`
    : "";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
       ${field}
       <g transform="translate(${off} ${off}) scale(${s})">${glyph(fg)}</g>
     </svg>`
  );
}

const png = (buf, path) => sharp(buf).png().toFile(join(PUBLIC, path));

// ── Apple splash screens ──────────────────────────────────────────────────────
// iOS will not show a launch image unless a <link> matches the device EXACTLY —
// width, height, pixel ratio and orientation. Miss by one and you get a blank
// white screen instead. Hence the device table; there is no wildcard.
const DEVICES = [
  { w: 430,  h: 932,  dpr: 3 }, // iPhone 15/16 Pro Max
  { w: 393,  h: 852,  dpr: 3 }, // iPhone 14/15/16 Pro
  { w: 428,  h: 926,  dpr: 3 }, // iPhone 12–14 Pro Max
  { w: 390,  h: 844,  dpr: 3 }, // iPhone 12/13/14
  { w: 375,  h: 812,  dpr: 3 }, // iPhone X/XS/11 Pro
  { w: 414,  h: 896,  dpr: 3 }, // iPhone XS Max / 11 Pro Max
  { w: 414,  h: 896,  dpr: 2 }, // iPhone XR / 11
  { w: 414,  h: 736,  dpr: 3 }, // iPhone 8 Plus
  { w: 375,  h: 667,  dpr: 2 }, // iPhone SE / 8
  { w: 1024, h: 1366, dpr: 2 }, // iPad Pro 12.9"
  { w: 834,  h: 1194, dpr: 2 }, // iPad Pro 11"
  { w: 834,  h: 1112, dpr: 2 }, // iPad Pro 10.5"
  { w: 820,  h: 1180, dpr: 2 }, // iPad Air
  { w: 768,  h: 1024, dpr: 2 }, // iPad 9.7"
];

async function splash(pxW, pxH, file) {
  // The mark sits at a fixed fraction of the SHORT edge, so it looks the same
  // size on a phone and on a 12.9" iPad.
  const markPx = Math.round(Math.min(pxW, pxH) * 0.42);
  const mark = await sharp(
    icon({ size: markPx, bg: null, fg: BRAND, scale: 1, radius: 0 })
  )
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: pxW,
      height: pxH,
      channels: 4,
      background: CANVAS,
    },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toFile(join(PUBLIC, file));
}

await mkdir(join(PUBLIC, "icons"), { recursive: true });
await mkdir(join(PUBLIC, "splash"), { recursive: true });

// ── Launcher icons ────────────────────────────────────────────────────────────
// `any` icons are shown as-authored, so they carry their own rounded corners.
// Ink ends up ~62% of the edge, which is the usual weight for a launcher icon.
const ANY = 1.1;
for (const size of [192, 256, 384, 512]) {
  await png(
    icon({ size, bg: BRAND, fg: "#ffffff", scale: ANY, radius: 0.22 }),
    `icons/icon-${size}.png`
  );
}

// `maskable` icons are CROPPED by the platform to whatever shape it likes — a
// circle on Pixel, a squircle on Samsung. So: bleed the field to the very edge
// (no rounded corners of our own, or they show up as notches), and keep the ink
// inside the safe circle (radius 40% of the edge) that the spec guarantees will
// survive any mask.
const MASKABLE = 1.0;
if (ART_R * MASKABLE > 0.4) throw new Error("maskable ink escapes the safe circle");
for (const size of [192, 512]) {
  await png(
    icon({ size, bg: BRAND, fg: "#ffffff", scale: MASKABLE, radius: 0 }),
    `icons/maskable-${size}.png`
  );
}

// iOS applies its own squircle mask and does NOT honour transparency — a
// transparent corner comes out black — so this one is a full-bleed square too.
await png(
  icon({ size: 180, bg: BRAND, fg: "#ffffff", scale: 1.05, radius: 0 }),
  "icons/apple-touch-icon.png"
);

// A favicon is read at 16px in a tab strip, so the ink is pushed as large as the
// field allows.
for (const size of [32, 16]) {
  await png(
    icon({ size, bg: BRAND, fg: "#ffffff", scale: 1.25, radius: 0.2 }),
    `icons/favicon-${size}.png`
  );
}
console.log(`ink covers ${(ART_W * ANY * 100).toFixed(0)}% of an "any" icon`);

// ── Splash screens, both orientations ─────────────────────────────────────────
const entries = [];
for (const d of DEVICES) {
  const pw = d.w * d.dpr;
  const ph = d.h * d.dpr;

  const portrait = `splash/${d.w}x${d.h}@${d.dpr}x-portrait.png`;
  const landscape = `splash/${d.w}x${d.h}@${d.dpr}x-landscape.png`;

  await splash(pw, ph, portrait);
  await splash(ph, pw, landscape);

  entries.push(
    {
      href: `/${portrait}`,
      media: `(device-width: ${d.w}px) and (device-height: ${d.h}px) and (-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: portrait)`,
    },
    {
      href: `/${landscape}`,
      media: `(device-width: ${d.w}px) and (device-height: ${d.h}px) and (-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: landscape)`,
    }
  );
}

// Emit the <link> table rather than hand-maintaining 28 tags next to a 14-row
// device list that would drift apart the first time a phone is added.
await writeFile(
  join(ROOT, "lib", "pwa", "apple-splash.ts"),
  `// GENERATED by scripts/generate-pwa-assets.mjs — do not edit by hand.
// iOS matches a launch image on an exact device-width/height/DPR/orientation
// query; anything unmatched simply gets a blank screen.
export const APPLE_SPLASH: { href: string; media: string }[] = ${JSON.stringify(
    entries,
    null,
    2
  )};
`,
  "utf8"
);

console.log(
  `Wrote ${4 + 2 + 1 + 2} icons and ${entries.length} splash screens, ` +
    `plus lib/pwa/apple-splash.ts`
);
