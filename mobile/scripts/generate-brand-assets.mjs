// Generates app icons and splash images from the Runner symbol (design canvas: "Logo" board).
// Usage: npm run brand-assets
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (name) => join(root, 'assets', name);

const BRAND = '#1F4FD1';
const HEX = 'M50,6 88.1,28 88.1,72 50,94 11.9,72 11.9,28Z';
const ROUTE = 'M31,72 V52 C31,41 39,34 50,34 H54';

/** The symbol in a 100×100 box: filled hexagon with the "r" route and location dot. */
function symbol({ hex, mark, small = false }) {
  const route = small ? 13 : 11;
  const dot = small ? { cx: 68, r: 9 } : { cx: 66, r: 7.5 };
  return `<path d="${HEX}" fill="${hex}" stroke="${hex}" stroke-width="8" stroke-linejoin="round"/>
<path d="${ROUTE}" fill="none" stroke="${mark}" stroke-width="${route}" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="${dot.cx}" cy="34" r="${dot.r}" fill="${mark}"/>`;
}

/** Line-only symbol for the Android themed (monochrome) icon. */
const outline = (color) => `<path d="${HEX}" fill="none" stroke="${color}" stroke-width="7" stroke-linejoin="round"/>
<path d="${ROUTE}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="66" cy="34" r="7" fill="${color}"/>`;

/** Places a 100×100 symbol at `scale` of a square canvas, optionally on a background. */
function canvas(size, scale, inner, background) {
  const s = (size * scale) / 100;
  const offset = (size - size * scale) / 2;
  const bg = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}<g transform="translate(${offset} ${offset}) scale(${s})">${inner}</g></svg>`;
}

function write(name, svg, size) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  mkdirSync(dirname(out(name)), { recursive: true });
  writeFileSync(out(name), png);
  writeFileSync(out(`brand/${name.replace('.png', '.svg')}`), svg);
  console.log(`${name} (${size}px)`);
}

// iOS / store icon: white symbol on brand blue, 92/132 of the tile (design ratio). No transparency.
write('icon.png', canvas(1024, 0.697, symbol({ hex: '#FFFFFF', mark: BRAND }), BRAND), 1024);
// Android adaptive icon: foreground inside the 66% safe zone; background colour comes from app.config.
write('android-icon-foreground.png', canvas(1024, 0.576, symbol({ hex: '#FFFFFF', mark: BRAND })), 1024);
write('android-icon-monochrome.png', canvas(1024, 0.576, outline('#000000')), 1024);
// Splash: frame 0 of the opening animation — the hexagon alone on a flat background;
// the in-app animation then draws the route and the dot inside it.
const hexOnly = (color) => `<path d="${HEX}" fill="${color}" stroke="${color}" stroke-width="8" stroke-linejoin="round"/>`;
write('splash-icon.png', canvas(1024, 1, hexOnly(BRAND)), 1024);
write('splash-icon-dark.png', canvas(1024, 1, hexOnly('#7FA3FF')), 1024);
// Web favicon uses the optically corrected small symbol.
write('favicon.png', canvas(48, 0.8, symbol({ hex: BRAND, mark: '#FFFFFF', small: true })), 48);
