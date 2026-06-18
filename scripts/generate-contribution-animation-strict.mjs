import { mkdir, writeFile } from 'node:fs/promises';

const USER = process.env.GITHUB_USER || 'advik-bhatt';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

// === CANVAS ===
const W = 847, H = 260;
const DOT = 11, STEP = 15, PAD_X = 28, GRID_Y = 72;
const MAP_DOT = 5;  // dot size in the world map
const MAP_X = 58, MAP_Y = 26, MAP_W = 730, MAP_H = 204;

// === TIMING (24s loop) ===
const LOOP      = 24;
const GRID_HOLD = 4.5;   // grid shown solid
const FLY_END   = 9.2;   // last commit arrives
const MAP_HOLD  = 20.0;  // map held until reset
const COMMIT_FADE = FLY_END + 1.6;  // commits absorbed into map layer
const DAY = 86400000;

// === GITHUB DATA ===
const Q = `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{contributionCount contributionLevel date weekday}}}}}}`;
const now = new Date();
const from = new Date(now.getTime() - 370 * DAY);
const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: Q, variables: { login: USER, from: from.toISOString(), to: now.toISOString() } }),
});
if (!res.ok) throw new Error(`GraphQL ${res.status}`);
const data = await res.json();
if (data.errors?.length) throw new Error(JSON.stringify(data.errors));
const weeks = data.data.user.contributionsCollection.contributionCalendar.weeks;
const cells = weeks.flatMap((week, col) => week.contributionDays.map(day => ({
  col, row: day.weekday, count: day.contributionCount, level: day.contributionLevel,
})));
const active = cells.filter(c => c.count > 0);

// === PROJECTION ===
function proj(lon, lat) {
  return {
    x: MAP_X + ((lon + 180) / 360) * MAP_W,
    y: MAP_Y + ((90 - lat) / 180) * MAP_H,
  };
}

// === LAND MASK ===
function isLand(lon, lat) {
  const e = (cx, cy, rx, ry) => ((lon - cx) / rx) ** 2 + ((lat - cy) / ry) ** 2 <= 1;
  if (e(-150, 63, 22, 11)) return true;  // Alaska
  if (e(-120, 56, 18, 12)) return true;  // W Canada
  if (e(-100, 50, 30, 14)) return true;  // Central N America
  if (e(-85, 42, 22, 12)) return true;   // E USA / SE Canada
  if (e(-88, 33, 12, 8))  return true;   // SE USA
  if (e(-102, 22, 14, 12)) return true;  // Mexico
  if (lon > -91 && lon < -77 && lat > 8 && lat < 18 && e(-84, 13, 10, 7)) return true;
  if (e(-68, 8, 18, 8))   return true;   // N South America
  if (e(-60, -12, 28, 44)) return true;  // South America main
  if (e(-65, -40, 10, 16)) return true;  // Patagonia
  if (e(8, 50, 22, 12))   return true;   // W Europe
  if (e(28, 52, 18, 12))  return true;   // E Europe
  if (e(-4, 40, 8, 6))    return true;   // Iberian
  if (e(13, 42, 5, 9))    return true;   // Italy
  if (e(22, 40, 7, 6))    return true;   // Greece
  if (e(-2, 54, 5, 6))    return true;   // UK
  if (lon > 5 && lon < 32 && lat > 56 && lat < 71 && e(18, 63, 14, 9)) return true;  // Scandinavia
  if (e(18, 26, 32, 16))  return true;   // N Africa
  if (e(4, 10, 20, 14))   return true;   // W Africa
  if (e(36, 6, 16, 20))   return true;   // E Africa
  if (e(25, -22, 16, 18)) return true;   // S Africa
  if (e(46, -20, 4, 10))  return true;   // Madagascar
  if (e(44, 24, 16, 12))  return true;   // Arabia
  if (e(36, 39, 12, 6))   return true;   // Turkey
  if (e(56, 32, 16, 10))  return true;   // Iran
  if (e(50, 58, 30, 10))  return true;   // W Russia
  if (e(90, 60, 36, 10))  return true;   // C Russia
  if (e(140, 60, 26, 12)) return true;   // E Russia
  if (e(68, 46, 18, 10))  return true;   // Kazakhstan
  if (e(78, 22, 14, 16))  return true;   // India
  if (e(104, 36, 30, 18)) return true;   // China
  if (e(122, 38, 10, 10)) return true;   // NE China / Korea
  if (e(104, 16, 18, 14)) return true;   // SE Asia mainland
  if (e(108, -2, 18, 6))  return true;   // Indonesia
  if (e(137, 37, 4, 8))   return true;   // Japan
  if (e(134, -25, 24, 15)) return true;  // Australia
  if (e(-42, 72, 22, 12)) return true;   // Greenland
  if (e(-19, 65, 6, 4))   return true;   // Iceland
  return false;
}

// === DENSE LAND DOT GRID (the world map is made of these) ===
// 5° lat × 6° lon step → ~380 land dots filling all continents
const landDots = [];
for (let lat = 71; lat >= -52; lat -= 5) {
  for (let lon = -173; lon <= 174; lon += 6) {
    if (!isLand(lon, lat)) continue;
    const p = proj(lon, lat);
    landDots.push({ cx: p.x, cy: p.y });
  }
}

// === SEEDED RNG + SHUFFLE ===
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const seed = active.reduce((s, c) => (s + c.count * (c.col + 3) * 7 + c.row * 13) | 0, 42);
const rng = mulberry32(seed);
// Shuffle so commits don't map to land dots in sorted order (prevents row/column bands)
const shuffledLand = shuffle(landDots, rng);

function getTargets(count) {
  if (!count || !shuffledLand.length) return [];
  return Array.from({ length: count }, (_, i) => {
    const idx = Math.round((i / Math.max(count - 1, 1)) * (shuffledLand.length - 1));
    return shuffledLand[idx];
  });
}
const targets = getTargets(active.length);

// === SVG HELPERS ===
const gx = col => PAD_X + col * STEP;
const gy = row => GRID_Y + row * STEP;
const kt = (...ts) => ts.map(t => Math.max(0, Math.min(1, t / LOOP)).toFixed(5)).join(';');

// === BUILD SVG ===
function buildSvg(theme) {
  const { id, bg, frame, ocean, gridEmpty, gridStroke, levels, baseLand } = theme;

  // --- Grid (fades to ghost while map is shown) ---
  const gridCells = cells.map(c =>
    `<rect x="${gx(c.col)}" y="${gy(c.row)}" width="${DOT}" height="${DOT}" rx="2.4" fill="${gridEmpty}" stroke="${gridStroke}" stroke-width=".6"/>`
  ).join('');
  const gridGroup = `<g>
    <animate attributeName="opacity" values="1;1;0.07;0.07;1" keyTimes="${kt(0,GRID_HOLD,FLY_END,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
    ${gridCells}
  </g>`;

  // --- Map layer: dense land dots colored by nearest paint-drop commit (Voronoi) ---
  // Each land dot takes the color of whichever commit landed closest to it.
  // Dots beyond PAINT_RADIUS of any commit use baseLand (faint base).
  const PAINT_RADIUS = 82;
  const drops = targets.map((t, i) => ({
    cx: t.cx, cy: t.cy,
    color: levels[active[i].level] || levels.SECOND_QUARTILE,
  }));

  const colorGroups = new Map();
  for (const dot of landDots) {
    let minD2 = Infinity;
    let color = baseLand;
    for (const drop of drops) {
      const d2 = (dot.cx - drop.cx) ** 2 + (dot.cy - drop.cy) ** 2;
      if (d2 < minD2) { minD2 = d2; color = drop.color; }
    }
    if (minD2 > PAINT_RADIUS * PAINT_RADIUS) color = baseLand;
    if (!colorGroups.has(color)) colorGroups.set(color, []);
    colorGroups.get(color).push(dot);
  }

  // Each color group fades in together when commits have landed.
  // Using slightly different timing per group creates a subtle wave as the map solidifies.
  const colorList = [...colorGroups.keys()];
  const mapLayer = colorList.map((color, gi) => {
    const rects = colorGroups.get(color).map(d =>
      `<rect x="${(d.cx - MAP_DOT / 2).toFixed(1)}" y="${(d.cy - MAP_DOT / 2).toFixed(1)}" width="${MAP_DOT}" height="${MAP_DOT}" rx="1.2"/>`
    ).join('');
    const appear = +(FLY_END - 0.4 + gi * 0.1).toFixed(2);
    const solid  = +(appear + 0.6).toFixed(2);
    const opacity = color === baseLand ? '0.45' : '0.9';
    return `<g fill="${color}">
      <animate attributeName="opacity" values="0;0;${opacity};${opacity};0" keyTimes="${kt(0,appear,solid,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
      ${rects}
    </g>`;
  }).join('');

  // --- Commit squares: fly as paint drops from grid → map, collapse on landing ---
  const commitSquares = active.map((cell, i) => {
    const t = targets[i] || { cx: gx(cell.col), cy: gy(cell.row) };
    const sx  = gx(cell.col);
    const sy  = gy(cell.row);
    // Center-aligned coordinates at each phase
    const fax = +(t.cx - DOT / 2).toFixed(2);      // x at arrive (DOT size, centered on target)
    const fay = +(t.cy - DOT / 2).toFixed(2);
    const mx  = +(t.cx - MAP_DOT / 2).toFixed(2);  // x at map (MAP_DOT size)
    const my  = +(t.cy - MAP_DOT / 2).toFixed(2);

    // Stagger: spread all departures across 1.8s
    const depart  = +(GRID_HOLD + (i / Math.max(active.length - 1, 1)) * 1.8).toFixed(3);
    const arrive  = +Math.min(depart + 2.8, FLY_END + 0.5).toFixed(3);
    const snap    = +(arrive + 0.08).toFixed(3);  // snap to MAP_DOT
    const color   = levels[cell.level] || levels.SECOND_QUARTILE;

    // x, y: 6 keyframes: sit → depart → arrive (DOT-centered) → snap (MAP_DOT) → hold → reset
    // width/height: 6 matching keyframes
    // opacity: blink flash at landing, then fade out as map layer takes over
    return `<rect x="${sx}" y="${sy}" width="${DOT}" height="${DOT}" rx="2.4" fill="${color}">
      <animate attributeName="x" values="${sx};${sx};${fax};${mx};${mx};${sx}" keyTimes="${kt(0,depart,arrive,snap,COMMIT_FADE,LOOP)}" dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="y" values="${sy};${sy};${fay};${my};${my};${sy}" keyTimes="${kt(0,depart,arrive,snap,COMMIT_FADE,LOOP)}" dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="width" values="${DOT};${DOT};${DOT};${MAP_DOT};${MAP_DOT};${DOT}" keyTimes="${kt(0,depart,arrive,snap,COMMIT_FADE,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
      <animate attributeName="height" values="${DOT};${DOT};${DOT};${MAP_DOT};${MAP_DOT};${DOT}" keyTimes="${kt(0,depart,arrive,snap,COMMIT_FADE,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
      <animate attributeName="rx" values="2.4;2.4;2.4;1.5;1.5;2.4" keyTimes="${kt(0,depart,arrive,snap,COMMIT_FADE,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="1;1;0.3;1;0;0" keyTimes="${kt(0,depart,arrive,snap,COMMIT_FADE,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
    </rect>`;
  }).join('');

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub contributions animating into a world map">
  <defs>
    <linearGradient id="ocean-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="${ocean[0]}"/>
      <stop offset="1" stop-color="${ocean[1]}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="20" fill="${bg}"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="19" stroke="${frame}" stroke-width="1.5"/>
  <rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="13" fill="url(#ocean-${id})"/>
  ${gridGroup}
  ${mapLayer}
  ${commitSquares}
</svg>`;
}

// === THEMES ===
const themes = {
  dark: {
    id: 'dark',
    bg: '#040d1b',
    frame: '#0f2d4a',
    ocean: ['#070f1e', '#0a1628'],
    gridEmpty: '#0d1a2e',
    gridStroke: '#162338',
    baseLand: '#0a2a18',  // dark green for unpainted land
    levels: {
      NONE:            '#0d1a2e',
      FIRST_QUARTILE:  '#0e4429',
      SECOND_QUARTILE: '#006d32',
      THIRD_QUARTILE:  '#26a641',
      FOURTH_QUARTILE: '#39d353',
    },
  },
  light: {
    id: 'light',
    bg: '#f0f4f8',
    frame: '#94a3b8',
    ocean: ['#dbeafe', '#bfdbfe'],
    gridEmpty: '#ebedf0',
    gridStroke: '#d1d5db',
    baseLand: '#c6efce',  // faint green for unpainted land
    levels: {
      NONE:            '#ebedf0',
      FIRST_QUARTILE:  '#9be9a8',
      SECOND_QUARTILE: '#40c463',
      THIRD_QUARTILE:  '#30a14e',
      FOURTH_QUARTILE: '#216e39',
    },
  },
};

await mkdir('dist', { recursive: true });
await writeFile('dist/github-contribution-grid-snake-dark.svg', buildSvg(themes.dark));
await writeFile('dist/github-contribution-grid-snake.svg', buildSvg(themes.light));
console.log(`Paint-drop world map: ${active.length} commits, ${landDots.length} land dots.`);
