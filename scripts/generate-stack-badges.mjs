#!/usr/bin/env node
/**
 * Builds assets/badges/*.svg — the Stack row in the profile README.
 *
 *   node scripts/generate-stack-badges.mjs             glyph + label
 *   node scripts/generate-stack-badges.mjs --no-icons  label only
 *
 * The badges are modelled on Apple's Liquid Glass (iOS 26), not on the glossy
 * pill that shipped with iPhone OS 3. The difference is where the light sits.
 * A 2010 badge put one broad specular sweep across the top half of the shape
 * and a steep dark-to-light gradient underneath it. Liquid Glass is close to
 * flat through the body, translucent enough that the page tints it, and does
 * its work at the rim: light gathers along the top edge, thins across the
 * flanks, and returns along the bottom where the lens bends it back through
 * the material. The end caps of a capsule read brighter for the same reason.
 *
 * Everything here is derived, not hand-tuned per brand:
 *
 *   - Brand colours come from simple-icons (vendored in stack-badge-icons.json
 *     so this script has no dependencies and no network).
 *   - The body colour is the brand hue moved into a band where a translucent
 *     material still reads as itself on both GitHub canvases, then darkened or
 *     lightened until the label clears WCAG AA (4.5:1) against the composite on
 *     BOTH #ffffff and #0d1117. No theme switching, no prefers-color-scheme:
 *     one file that is correct in light and dark mode.
 *   - Widths are computed from Arial/Helvetica advance metrics, and every label
 *     carries textLength, so the capsule is the same size for every viewer no
 *     matter which font their machine substitutes for SF Pro.
 *
 * Java, SQL and Tavus ship without a glyph on purpose: there is no mark for
 * them in simple-icons and inventing one would be faking a logo.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, 'assets/badges');
const ICONS = JSON.parse(readFileSync(resolve(HERE, 'stack-badge-icons.json'), 'utf8'));
const WITH_GLYPHS = !process.argv.includes('--no-icons');

// ---------------------------------------------------------------- geometry --
const H = 44;          // canvas height: capsule plus room for its shadow
const CAP_Y = 3;       // capsule top edge
const CAP_H = 36;      // capsule height
const R = CAP_H / 2;   // capsule radius
const FS = 15.5;       // label size
const PAD = 16;        // space before the glyph and after the label
const ICON = 17;       // glyph box
const GAP = 8;         // glyph to label
const ALPHA = 0.94;    // body translucency — the page tints the material

const FONT =
  "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

const CANVAS_LIGHT = '#ffffff'; // GitHub light canvas
const CANVAS_DARK = '#0d1117';  // GitHub dark canvas
const INK_LIGHT = '#ffffff';
const INK_DARK = '#141210';

// ------------------------------------------------------------------ colour --
const hex2rgb = (h) => {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const rgb2hex = (...v) =>
  '#' + v.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('');

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => (v + m) * 255);
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const shift = (hex, dL, dS = 0) => {
  const [h, s, l] = rgb2hsl(...hex2rgb(hex));
  return rgb2hex(...hsl2rgb(h, clamp01(s + dS), clamp01(l + dL)));
};
const luminance = (hex) => {
  const [r, g, b] = hex2rgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const composite = (fg, alpha, bg) => {
  const f = hex2rgb(fg);
  const b = hex2rgb(bg);
  return rgb2hex(...f.map((v, i) => v * alpha + b[i] * (1 - alpha)));
};

/**
 * Brand hex -> the glass body and the ink that survives on both canvases.
 * Pure blacks become graphite (a black lens reads as a hole, not a material)
 * and fluorescent yellows come down a step. Then the body walks toward or away
 * from its ink until the label clears 4.5:1 composited over white AND over
 * #0d1117 — and it tries white ink and dark ink both ways, keeping whichever
 * needed the smaller move. Picking ink by a fixed luminance threshold instead
 * drags mid-tone oranges like Java's a long way down into mud to make white
 * work, when black was one step away the whole time.
 */
function material(brand) {
  let [h, s, l] = rgb2hsl(...hex2rgb(brand));
  if (l < 0.22) l = 0.22;
  if (l > 0.78) l = Math.max(0.62, l - 0.14);
  const start = rgb2hex(...hsl2rgb(h, Math.min(s, 0.82), l));

  const solve = (ink) => {
    let body = start;
    const worst = () =>
      Math.min(
        contrast(ink, composite(body, ALPHA, CANVAS_LIGHT)),
        contrast(ink, composite(body, ALPHA, CANVAS_DARK)),
      );
    let steps = 0;
    while (steps < 40 && worst() < 4.5) {
      body = shift(body, ink === INK_LIGHT ? -0.015 : 0.015);
      steps++;
    }
    return { body, ink, ratio: worst(), steps, ok: worst() >= 4.5 };
  };

  const onWhite = solve(INK_LIGHT);
  const onBlack = solve(INK_DARK);
  if (!onWhite.ok) return onBlack;
  if (!onBlack.ok) return onWhite;
  return onWhite.steps <= onBlack.steps ? onWhite : onBlack;
}

// ------------------------------------------------------------------ metrics --
// Advance widths for Arial/Helvetica semibold at font-size 1, measured in
// Chromium. Summed per character they run <=3% wide of a kerned string, which
// only ever buys the capsule a little more breathing room. Re-measure with
// canvas measureText if a label ever needs a character outside this range.
const ADVANCE = {
  ' ': 0.28, '!': 0.33, '"': 0.47, '#': 0.56, $: 0.56, '%': 0.89, '&': 0.72, "'": 0.24,
  '(': 0.33, ')': 0.33, '*': 0.39, '+': 0.58, ',': 0.28, '-': 0.33, '.': 0.28, '/': 0.28,
  0: 0.56, 1: 0.56, 2: 0.56, 3: 0.56, 4: 0.56, 5: 0.56, 6: 0.56, 7: 0.56, 8: 0.56, 9: 0.56,
  ':': 0.33, ';': 0.33, '<': 0.58, '=': 0.58, '>': 0.58, '?': 0.61, '@': 0.98,
  A: 0.72, B: 0.72, C: 0.72, D: 0.72, E: 0.67, F: 0.61, G: 0.78, H: 0.72, I: 0.28, J: 0.56,
  K: 0.72, L: 0.61, M: 0.83, N: 0.72, O: 0.78, P: 0.67, Q: 0.78, R: 0.72, S: 0.67, T: 0.61,
  U: 0.72, V: 0.67, W: 0.94, X: 0.67, Y: 0.67, Z: 0.61,
  '[': 0.28, '\\': 0.28, ']': 0.28, '^': 0.47, _: 0.56, '`': 0.33,
  a: 0.56, b: 0.61, c: 0.56, d: 0.61, e: 0.56, f: 0.33, g: 0.61, h: 0.61, i: 0.28, j: 0.28,
  k: 0.56, l: 0.28, m: 0.89, n: 0.61, o: 0.61, p: 0.61, q: 0.61, r: 0.39, s: 0.56, t: 0.33,
  u: 0.61, v: 0.56, w: 0.78, x: 0.56, y: 0.56, z: 0.5,
  '{': 0.39, '|': 0.28, '}': 0.39, '~': 0.58,
};
const measure = (label, size) =>
  [...label].reduce((sum, ch) => sum + (ADVANCE[ch] ?? 0.61), 0) * size;

// ------------------------------------------------------------------- badge --
function badge(slug) {
  const { label, brand } = ICONS[slug];
  const path = WITH_GLYPHS ? ICONS[slug].path : null;
  const { body, ink, ratio } = material(brand);
  const onDarkInk = ink === INK_LIGHT;

  const top = shift(body, 0.03, -0.015);
  const bottom = shift(body, -0.03, 0.01);

  const textW = Math.round(measure(label, FS) * 10) / 10;
  const W = Math.round(PAD * 2 + (path ? ICON + GAP : 0) + textW);
  const textX = PAD + (path ? ICON + GAP : 0);
  const baseline = CAP_Y + CAP_H / 2 + FS * 0.35;
  const u = slug.replace(/[^a-z0-9]/g, '');

  // Rim light. Bright along the top edge, almost nothing on the flanks, and a
  // softer return along the bottom. Thin on purpose: a wide highlight here is
  // what made the old badges look like 2010. White rim on a pale body has very
  // little to bite into and turns into a halo, so light chips get about half
  // the intensity dark ones do.
  const rimTop = onDarkInk ? 0.6 : 0.3;
  const rimMid = onDarkInk ? 0.05 : 0.04;
  const rimBottom = onDarkInk ? 0.14 : 0.08;
  const capLight = onDarkInk ? 0.09 : 0.07;
  const sheen = onDarkInk ? 0.07 : 0.05;

  const glyph = path
    ? `\n<g transform="translate(${PAD} ${CAP_Y + (CAP_H - ICON) / 2}) scale(${(ICON / 24).toFixed(5)})" fill="${ink}" fill-opacity="0.94"><path d="${path}"/></g>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
<title>${label}</title>
<desc>Contrast ${ratio.toFixed(2)}:1 on both the light and dark GitHub canvas.</desc>
<defs>
<linearGradient id="body${u}" x1="0" y1="${CAP_Y}" x2="0" y2="${CAP_Y + CAP_H}" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/>
</linearGradient>
<linearGradient id="rim${u}" x1="0" y1="${CAP_Y}" x2="0" y2="${CAP_Y + CAP_H}" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="#ffffff" stop-opacity="${rimTop}"/>
<stop offset="0.3" stop-color="#ffffff" stop-opacity="${rimMid}"/>
<stop offset="0.76" stop-color="#ffffff" stop-opacity="${rimMid}"/>
<stop offset="1" stop-color="#ffffff" stop-opacity="${rimBottom}"/>
</linearGradient>
<linearGradient id="lens${u}" x1="0" y1="0" x2="${W}" y2="0" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="#ffffff" stop-opacity="${capLight}"/>
<stop offset="${(R / W).toFixed(4)}" stop-color="#ffffff" stop-opacity="0"/>
<stop offset="${(1 - R / W).toFixed(4)}" stop-color="#ffffff" stop-opacity="0"/>
<stop offset="1" stop-color="#ffffff" stop-opacity="${capLight}"/>
</linearGradient>
<filter id="cast${u}" x="-20%" y="-20%" width="140%" height="150%">
<feDropShadow dx="0" dy="0.8" stdDeviation="1" flood-color="#0a0f16" flood-opacity="0.16"/>
</filter>
<clipPath id="clip${u}"><rect x="0" y="${CAP_Y}" width="${W}" height="${CAP_H}" rx="${R}"/></clipPath>
</defs>
<g filter="url(#cast${u})"><rect x="0" y="${CAP_Y}" width="${W}" height="${CAP_H}" rx="${R}" fill="url(#body${u})" fill-opacity="${ALPHA}"/></g>
<g clip-path="url(#clip${u})">
<rect x="0" y="${CAP_Y}" width="${W}" height="${CAP_H}" fill="url(#lens${u})"/>
<rect x="1.5" y="${CAP_Y + 1.5}" width="${W - 3}" height="${CAP_H - 3}" rx="${R - 1.5}" fill="none" stroke="#ffffff" stroke-opacity="${sheen}" stroke-width="1.5"/>
</g>
<rect x="0.5" y="${CAP_Y + 0.5}" width="${W - 1}" height="${CAP_H - 1}" rx="${R - 0.5}" fill="none" stroke="url(#rim${u})" stroke-width="1"/>
<rect x="0.25" y="${CAP_Y + 0.25}" width="${W - 0.5}" height="${CAP_H - 0.5}" rx="${R - 0.25}" fill="none" stroke="#000000" stroke-opacity="0.09" stroke-width="0.5"/>${glyph}
<text x="${textX}" y="${baseline}" textLength="${textW}" lengthAdjust="spacingAndGlyphs" font-family="${FONT}" font-size="${FS}" font-weight="590" letter-spacing="-0.15" fill="${ink}">${label.replace(/&/g, '&amp;')}</text>
</svg>
`;
  return { svg, W, ratio, ink, body };
}

mkdirSync(OUT, { recursive: true });
let failures = 0;
for (const slug of Object.keys(ICONS)) {
  const { svg, W, ratio, ink, body } = badge(slug);
  writeFileSync(resolve(OUT, `${slug}.svg`), svg);
  if (ratio < 4.5) failures++;
  process.stdout.write(
    `${slug.padEnd(16)} ${String(W).padStart(4)}px  body ${body}  ink ${ink}  ${ratio.toFixed(2)}:1\n`,
  );
}
console.log(`\n${Object.keys(ICONS).length} badges written to assets/badges/`);
if (failures) {
  console.error(`${failures} badge(s) below 4.5:1 — fix before shipping`);
  process.exit(1);
}
