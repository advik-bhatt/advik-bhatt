import { mkdir, writeFile } from 'node:fs/promises';

const USER = process.env.GITHUB_USER || 'advik-bhatt';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

// === CANVAS ===
const W = 847, H = 260;
const DOT = 11, STEP = 15, PAD_X = 28, GRID_Y = 72;
const MAP_X = 58, MAP_Y = 26, MAP_W = 730, MAP_H = 204;

// === WATERCOLOR BLOB ===
const BLOB    = 38;    // expanded blob diameter (px) — how far paint spreads
const BLOB_OP = 0.72; // blob opacity (watercolor semi-transparency)

// === TIMING (24s loop) ===
const LOOP     = 24;
const GRID_END = 4.5;  // commits start departing at this time
const FLY_DUR  = 2.5;  // flight duration (grid → target)
const FLY_STAG = 1.5;  // total stagger spread: last departs 1.5s after first
const BLOB_DUR = 0.7;  // expansion from DOT → BLOB on landing
const MAP_HOLD = 16.5; // when reverse begins
const CONT_DUR = 0.8;  // contraction from BLOB → DOT
const FLY_BACK = 2.5;  // return flight duration (target → grid)

// === GITHUB DATA ===
const Q = `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{contributionCount contributionLevel date weekday}}}}}}` ;
const now  = new Date();
const from = new Date(now.getTime() - 370 * 86400000);
const res  = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: Q, variables: { login: USER, from: from.toISOString(), to: now.toISOString() } }),
});
if (!res.ok) throw new Error(`GraphQL ${res.status}`);
const data = await res.json();
if (data.errors?.length) throw new Error(JSON.stringify(data.errors));
const weeks  = data.data.user.contributionsCollection.contributionCalendar.weeks;
const cells  = weeks.flatMap((week, col) => week.contributionDays.map(day => ({
  col, row: day.weekday, count: day.contributionCount, level: day.contributionLevel,
})));
const active = cells.filter(c => c.count > 0);
const n      = active.length;

// === EQUIRECTANGULAR PROJECTION ===
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
  if (e(-85,  42, 22, 12)) return true;  // E USA / SE Canada
  if (e(-88,  33, 12,  8)) return true;  // SE USA
  if (e(-102, 22, 14, 12)) return true;  // Mexico
  if (e(-84,  13, 10,  7)) return true;  // C America
  if (e(-68,   8, 18,  8)) return true;  // N South America
  if (e(-60, -12, 28, 44)) return true;  // South America main
  if (e(-65, -40, 10, 16)) return true;  // Patagonia
  if (e(  8,  50, 22, 12)) return true;  // W Europe
  if (e( 28,  52, 18, 12)) return true;  // E Europe
  if (e( -4,  40,  8,  6)) return true;  // Iberian
  if (e( 13,  42,  5,  9)) return true;  // Italy
  if (e( 22,  40,  7,  6)) return true;  // Greece
  if (e( -2,  54,  5,  6)) return true;  // UK
  if (e( 18,  63, 14,  9)) return true;  // Scandinavia
  if (e( 18,  26, 32, 16)) return true;  // N Africa
  if (e(  4,  10, 20, 14)) return true;  // W Africa
  if (e( 36,   6, 16, 20)) return true;  // E Africa
  if (e( 25, -22, 16, 18)) return true;  // S Africa
  if (e( 46, -20,  4, 10)) return true;  // Madagascar
  if (e( 44,  24, 16, 12)) return true;  // Arabia
  if (e( 36,  39, 12,  6)) return true;  // Turkey
  if (e( 56,  32, 16, 10)) return true;  // Iran
  if (e( 50,  58, 30, 10)) return true;  // W Russia
  if (e( 90,  60, 36, 10)) return true;  // C Russia
  if (e(140,  60, 26, 12)) return true;  // E Russia
  if (e( 68,  46, 18, 10)) return true;  // Kazakhstan
  if (e( 78,  22, 14, 16)) return true;  // India
  if (e(104,  36, 30, 18)) return true;  // China
  if (e(122,  38, 10, 10)) return true;  // NE China / Korea
  if (e(104,  16, 18, 14)) return true;  // SE Asia mainland
  if (e(108,  -2, 18,  6)) return true;  // Indonesia
  if (e(137,  37,  4,  8)) return true;  // Japan
  if (e(134, -25, 24, 15)) return true;  // Australia
  if (e(-42,  72, 22, 12)) return true;  // Greenland
  if (e(-19,  65,  6,  4)) return true;  // Iceland
  return false;
}

// === LAND SAMPLE POINTS for geographic target placement ===
const landPoints = [];
for (let lat = 71; lat >= -52; lat -= 3) {
  for (let lon = -173; lon <= 174; lon += 4) {
    if (!isLand(lon, lat)) continue;
    const p = proj(lon, lat);
    landPoints.push({ cx: p.x, cy: p.y });
  }
}

// === SEEDED RNG + SHUFFLE (prevents row/column banding) ===
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

const seed        = active.reduce((s, c) => (s + c.count * (c.col + 3) * 7 + c.row * 13) | 0, 42);
const rng         = mulberry32(seed);
const shuffledLand = shuffle(landPoints, rng);

function getTargets(count) {
  if (!count || !shuffledLand.length) return [];
  const step = shuffledLand.length / count;
  return Array.from({ length: count }, (_, i) => shuffledLand[Math.floor(i * step)]);
}
const targets = getTargets(n);

// === HELPERS ===
const gx = col => PAD_X + col * STEP;
const gy = row => GRID_Y + row * STEP;
const kt = (...ts) => ts.map(t => Math.max(0, Math.min(1, t / LOOP)).toFixed(5)).join(';');

// Grid opacity timing
const G_OUT = GRID_END + FLY_STAG;                             // all commits have departed
const G_IN  = MAP_HOLD + FLY_STAG + 0.001 + CONT_DUR + FLY_BACK; // all commits returned

// === BUILD SVG ===
function buildSvg(theme) {
  const { id, bg, frame, gridEmpty, gridStroke, levels } = theme;

  // Grid: ghost empty cells, fade out while map is shown, fade back on return
  const gridCells = cells.map(c =>
    `<rect x="${gx(c.col)}" y="${gy(c.row)}" width="${DOT}" height="${DOT}" rx="2.4" fill="${gridEmpty}" stroke="${gridStroke}" stroke-width=".6"/>`
  ).join('');
  const gridGroup = `<g>
    <animate attributeName="opacity" values="1;1;0;0;1;1" keyTimes="${kt(0, GRID_END, G_OUT, MAP_HOLD, G_IN, LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
    ${gridCells}
  </g>`;

  // Commit blobs: 9-keyframe full cycle — depart → fly → land DOT → expand BLOB → hold →
  //   contract BLOB→DOT → fly back → arrive grid → hold until loop
  const commitBlobs = active.map((cell, i) => {
    const t  = targets[i] || { cx: gx(cell.col) + DOT / 2, cy: gy(cell.row) + DOT / 2 };
    const sx = gx(cell.col);
    const sy = gy(cell.row);

    // Center-aligned at target for each size
    const fax = +(t.cx - DOT  / 2).toFixed(2);
    const fay = +(t.cy - DOT  / 2).toFixed(2);
    const bx  = +(t.cx - BLOB / 2).toFixed(2);
    const by  = +(t.cy - BLOB / 2).toFixed(2);

    // Forward stagger: first commit departs earliest
    const dep    = GRID_END + (i / Math.max(n - 1, 1)) * FLY_STAG;
    const arr    = dep + FLY_DUR;
    const blob_t = arr + BLOB_DUR;

    // Reverse stagger: LIFO — last to arrive is first to start contracting
    const r_dep   = MAP_HOLD + ((n - 1 - i) / Math.max(n - 1, 1)) * FLY_STAG + 0.001;
    const r_c_end = r_dep + CONT_DUR;
    const r_arr   = r_c_end + FLY_BACK;

    const color = levels[cell.level] || levels.SECOND_QUARTILE;
    const times = kt(0, dep, arr, blob_t, MAP_HOLD, r_dep, r_c_end, r_arr, LOOP);

    return `<rect x="${sx}" y="${sy}" width="${DOT}" height="${DOT}" rx="2.4" fill="${color}">
      <animate attributeName="x"       values="${sx};${sx};${fax};${bx};${bx};${bx};${fax};${sx};${sx}" keyTimes="${times}" dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="y"       values="${sy};${sy};${fay};${by};${by};${by};${fay};${sy};${sy}" keyTimes="${times}" dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="width"   values="${DOT};${DOT};${DOT};${BLOB};${BLOB};${BLOB};${DOT};${DOT};${DOT}" keyTimes="${times}" dur="${LOOP}s" repeatCount="indefinite"/>
      <animate attributeName="height"  values="${DOT};${DOT};${DOT};${BLOB};${BLOB};${BLOB};${DOT};${DOT};${DOT}" keyTimes="${times}" dur="${LOOP}s" repeatCount="indefinite"/>
      <animate attributeName="rx"      values="2.4;2.4;2.4;${BLOB/2};${BLOB/2};${BLOB/2};2.4;2.4;2.4" keyTimes="${times}" dur="${LOOP}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="1;1;0.9;${BLOB_OP};${BLOB_OP};${BLOB_OP};1;1;1" keyTimes="${times}" dur="${LOOP}s" repeatCount="indefinite"/>
    </rect>`;
  }).join('');

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub contributions as watercolor paint drops forming a world map">
  <rect width="${W}" height="${H}" rx="20" fill="${bg}"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="19" stroke="${frame}" stroke-width="1.5"/>
  ${gridGroup}
  ${commitBlobs}
</svg>`;
}

// === THEMES (paper aesthetic) ===
const themes = {
  dark: {
    id: 'dark',
    bg: '#120f09',
    frame: '#2a2218',
    gridEmpty: '#1e1a12',
    gridStroke: '#2a2218',
    levels: {
      NONE:            '#1e1a12',
      FIRST_QUARTILE:  '#1a4a2e',
      SECOND_QUARTILE: '#1e6b3a',
      THIRD_QUARTILE:  '#26a641',
      FOURTH_QUARTILE: '#39d353',
    },
  },
  light: {
    id: 'light',
    bg: '#faf6ed',
    frame: '#d4c9b0',
    gridEmpty: '#ede7d8',
    gridStroke: '#d4c9b0',
    levels: {
      NONE:            '#ede7d8',
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
console.log(`Watercolor world map: ${n} commit drops on ${landPoints.length} land sample points.`);
