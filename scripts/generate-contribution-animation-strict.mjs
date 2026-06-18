import { mkdir, writeFile } from 'node:fs/promises';

const USER  = process.env.GITHUB_USER || 'advik-bhatt';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

// === CANVAS ===
const W = 847, H = 260;
const DOT = 11, STEP = 15, PAD_X = 28, GRID_Y = 72;
const MAP_X = 58, MAP_Y = 26, MAP_W = 730, MAP_H = 204;

// === TIMING (24s loop) ===
const LOOP      = 24;
const GRID_END  = 4.5;   // commits start departing
const FLY_DUR   = 2.5;   // flight to target
const FLY_STAG  = 1.5;   // stagger spread: last departs 1.5s after first
const MAP_HOLD  = 16.5;  // when map starts to reverse
const FLY_BACK  = 2.5;   // return flight
const BLOOM_IN   = GRID_END + FLY_STAG + FLY_DUR;  // 8.5 — last commit arrives
const BLOOM_END  = BLOOM_IN + 1.2;                  // 9.7 — map fully visible
const BLOOM_GONE = MAP_HOLD + 0.8;                  // 17.3 — map has faded out
const G_OUT      = GRID_END + FLY_STAG;             // 6.0 — all departed
const G_IN       = BLOOM_GONE + FLY_STAG + 0.101 + FLY_BACK; // 21.401 — all returned

// === GITHUB DATA ===
const Q = `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{contributionCount contributionLevel date weekday}}}}}}`;
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
  return { x: MAP_X + ((lon + 180) / 360) * MAP_W, y: MAP_Y + ((90 - lat) / 180) * MAP_H };
}

// === LAND MASK ===
function isLand(lon, lat) {
  const e = (cx, cy, rx, ry) => ((lon - cx) / rx) ** 2 + ((lat - cy) / ry) ** 2 <= 1;
  return (
    e(-150,63,22,11) || e(-120,56,18,12) || e(-100,50,30,14) || e(-85,42,22,12)  ||
    e(-88,33,12,8)   || e(-102,22,14,12) || e(-84,13,10,7)   || e(-68,8,18,8)    ||
    e(-60,-12,28,44) || e(-65,-40,10,16) || e(8,50,22,12)    || e(28,52,18,12)   ||
    e(-4,40,8,6)     || e(13,42,5,9)     || e(22,40,7,6)     || e(-2,54,5,6)     ||
    e(18,63,14,9)    || e(18,26,32,16)   || e(4,10,20,14)    || e(36,6,16,20)    ||
    e(25,-22,16,18)  || e(46,-20,4,10)   || e(44,24,16,12)   || e(36,39,12,6)    ||
    e(56,32,16,10)   || e(50,58,30,10)   || e(90,60,36,10)   || e(140,60,26,12)  ||
    e(68,46,18,10)   || e(78,22,14,16)   || e(104,36,30,18)  || e(122,38,10,10)  ||
    e(104,16,18,14)  || e(108,-2,18,6)   || e(137,37,4,8)    || e(134,-25,24,15) ||
    e(-42,72,22,12)  || e(-19,65,6,4)
  );
}

// === LAND SAMPLE POINTS ===
const landPoints = [];
for (let lat = 71; lat >= -52; lat -= 3) {
  for (let lon = -173; lon <= 174; lon += 4) {
    if (isLand(lon, lat)) landPoints.push(proj(lon, lat));
  }
}

// === SEEDED SHUFFLE (prevents row/column banding in geographic assignment) ===
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

const seed     = active.reduce((s, c) => (s + c.count * (c.col + 3) * 7 + c.row * 13) | 0, 42);
const shuffled = shuffle(landPoints, mulberry32(seed));
const targets  = n === 0 ? [] : Array.from({ length: n }, (_, i) => shuffled[Math.floor(i * shuffled.length / n)]);

// Blob radius scales with commit count: fewer commits → larger blobs for full coverage
const BLOB_R  = Math.min(50, Math.max(25, Math.round(55 * Math.sqrt(50 / Math.max(n, 10)))));
const BLUR_SD = Math.round(BLOB_R * 0.55);

// === HELPERS ===
const gx = col => PAD_X + col * STEP;
const gy = row => GRID_Y + row * STEP;
const kt = (...ts) => ts.map(t => (+Math.max(0, Math.min(1, t / LOOP))).toFixed(5)).join(';');

// === BUILD SVG ===
function buildSvg({ id, bg, frame, gridEmpty, gridStroke, levels }) {
  // --- Grid: fade out as commits depart, fade back in as they return ---
  const gridCells = cells.map(c =>
    `<rect x="${gx(c.col)}" y="${gy(c.row)}" width="${DOT}" height="${DOT}" rx="2.4" fill="${gridEmpty}" stroke="${gridStroke}" stroke-width=".6"/>`
  ).join('');
  const gridGroup = `<g>
    <animate attributeName="opacity" values="1;1;0;0;1;1" keyTimes="${kt(0, GRID_END, G_OUT, BLOOM_GONE, G_IN, LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
    ${gridCells}
  </g>`;

  // --- Watercolor map layer: Gaussian-blurred circles that merge into continent shapes ---
  const mapCircles = targets.map((t, i) => {
    const color = levels[active[i].level] || levels.SECOND_QUARTILE;
    return `<circle cx="${t.x.toFixed(1)}" cy="${t.y.toFixed(1)}" r="${BLOB_R}" fill="${color}"/>`;
  }).join('');
  const mapLayer = `<g filter="url(#blur-${id})" opacity="0">
    <animate attributeName="opacity" values="0;0;0.9;0.9;0;0" keyTimes="${kt(0, BLOOM_IN, BLOOM_END, MAP_HOLD, BLOOM_GONE, LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
    ${mapCircles}
  </g>`;

  // --- Flying commit squares: travel grid→target, fade out on arrival, return after map ---
  const flyers = active.map((cell, i) => {
    const t   = targets[i];
    const sx  = gx(cell.col), sy = gy(cell.row);
    const tx  = +(t.x - DOT / 2).toFixed(2), ty = +(t.y - DOT / 2).toFixed(2);
    const dep  = GRID_END + (i / Math.max(n - 1, 1)) * FLY_STAG;
    const arr  = dep + FLY_DUR;
    const gone = arr + 0.4;
    // LIFO reverse: last to arrive is first to depart back
    const r_dep = BLOOM_GONE + ((n - 1 - i) / Math.max(n - 1, 1)) * FLY_STAG + 0.001;
    const r_vis = r_dep + 0.1;
    const r_arr = r_vis + FLY_BACK;
    const color = levels[cell.level] || levels.SECOND_QUARTILE;
    const T     = kt(0, dep, arr, gone, MAP_HOLD, r_dep, r_vis, r_arr, LOOP);
    return `<rect x="${sx}" y="${sy}" width="${DOT}" height="${DOT}" rx="2.4" fill="${color}">
      <animate attributeName="x"       values="${sx};${sx};${tx};${tx};${tx};${tx};${tx};${sx};${sx}" keyTimes="${T}" dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="y"       values="${sy};${sy};${ty};${ty};${ty};${ty};${ty};${sy};${sy}" keyTimes="${T}" dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="opacity" values="1;1;0.5;0;0;0;1;1;1"                                 keyTimes="${T}" dur="${LOOP}s" repeatCount="indefinite"/>
    </rect>`;
  }).join('');

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub contributions as watercolor paint forming a world map">
  <defs>
    <filter id="blur-${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="${BLUR_SD}"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" rx="20" fill="${bg}"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="19" stroke="${frame}" stroke-width="1.5"/>
  ${gridGroup}
  ${mapLayer}
  ${flyers}
</svg>`;
}

// === THEMES ===
const themes = {
  dark: {
    id: 'dark',
    bg: '#0d1117',
    frame: '#30363d',
    gridEmpty: '#161b22',
    gridStroke: '#21262d',
    levels: {
      NONE:            '#161b22',
      FIRST_QUARTILE:  '#0e4429',
      SECOND_QUARTILE: '#006d32',
      THIRD_QUARTILE:  '#26a641',
      FOURTH_QUARTILE: '#39d353',
    },
  },
  light: {
    id: 'light',
    bg: '#ffffff',
    frame: '#d0d7de',
    gridEmpty: '#ebedf0',
    gridStroke: '#d0d7de',
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
await writeFile('dist/github-contribution-grid-snake.svg',      buildSvg(themes.light));
console.log(`Watercolor world map: ${n} blobs, BLOB_R=${BLOB_R}px, BLUR_SD=${BLUR_SD}px, ${landPoints.length} land pts.`);
