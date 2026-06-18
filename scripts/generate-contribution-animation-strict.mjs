import { mkdir, writeFile } from 'node:fs/promises';

const USER  = process.env.GITHUB_USER || 'advik-bhatt';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

// === CANVAS / BANNER ===
const W = 847, H = 260;
const DOT = 11, STEP = 15, PAD_X = 24, GRID_Y = 74;
const MAP_X = 20, MAP_Y = 16, MAP_W = 807, MAP_H = 228;

// === EQUIRECTANGULAR PROJECTION (fit inhabited latitude band to banner) ===
const LAT_MAX = 83, LAT_MIN = -56, LON_MIN = -180, LON_MAX = 180;
const proj = (lon, lat) => ({
  x: MAP_X + ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * MAP_W,
  y: MAP_Y + ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * MAP_H,
});

// === TIMING (24s loop) ===
const LOOP       = 24;
const GRID_END   = 4.5;                       // commits begin departing the grid
const FLY_DUR    = 2.5;                        // grid -> land flight time
const FLY_STAG   = 1.5;                         // departure stagger spread
const MAP_HOLD   = 16.5;                        // map begins to dissolve / commits return
const FLY_BACK   = 2.5;                          // land -> grid return flight time
const G_OUT      = GRID_END + FLY_STAG;          // grid fully faded (6.0)
const BLOOM_IN   = GRID_END + FLY_STAG + FLY_DUR; // last commit lands (8.5)
const BLOOM_END  = BLOOM_IN + 1.4;                // map fully painted (9.9)
const BLOOM_GONE = MAP_HOLD + 0.8;                // map fully dissolved (17.3)
const G_IN       = BLOOM_GONE + FLY_STAG + 0.1 + FLY_BACK; // grid fully back (21.4)

// === GITHUB CONTRIBUTION DATA ===
const Q = `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{contributionCount contributionLevel date weekday}}}}}}`;
const now  = new Date();
const from = new Date(now.getTime() - 370 * 86400000);
const res  = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: Q, variables: { login: USER, from: from.toISOString(), to: now.toISOString() } }),
});
if (!res.ok) throw new Error(`GraphQL ${res.status}`);
const gql = await res.json();
if (gql.errors?.length) throw new Error(JSON.stringify(gql.errors));
const weeks  = gql.data.user.contributionsCollection.contributionCalendar.weeks;
const cells  = weeks.flatMap((week, col) => week.contributionDays.map(day => ({
  col, row: day.weekday, count: day.contributionCount, level: day.contributionLevel,
})));
const active = cells.filter(c => c.count > 0);
const n      = active.length;

// === REAL WORLD GEOMETRY (Natural Earth land, projected to the banner) ===
async function fetchLand() {
  const url = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson';
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`land geojson ${r.status}`);
      return await r.json();
    } catch (e) { lastErr = e; await new Promise(s => setTimeout(s, 1500 * (attempt + 1))); }
  }
  throw lastErr;
}
const geo = await fetchLand();

// Project every ring; collect the full land path (for fill) and screen-space
// outer rings (for point-in-polygon land sampling).
const screenPolys = [];
let LAND = '';
function ringToPath(ring) {
  let d = '', px, py;
  const pts = [];
  for (let k = 0; k < ring.length; k++) {
    const p = proj(ring[k][0], ring[k][1]);
    const x = +p.x.toFixed(1), y = +p.y.toFixed(1);
    pts.push([x, y]);
    if (k && x === px && y === py) continue;
    d += (k ? 'L' : 'M') + x + ' ' + y;
    px = x; py = y;
  }
  return { d: d + 'Z', pts };
}
for (const f of geo.features) {
  const g = f.geometry; if (!g) continue;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const poly of polys) {
    const outer = poly[0];
    let maxLat = -99; for (const c of outer) if (c[1] > maxLat) maxLat = c[1];
    if (maxLat < -55) continue; // drop Antarctica
    const op = ringToPath(outer);
    screenPolys.push(op.pts);
    LAND += op.d;
    for (let i = 1; i < poly.length; i++) LAND += ringToPath(poly[i]).d; // lakes (holes)
  }
}

function inLand(x, y) {
  for (const ring of screenPolys) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

// Sample on-land screen points — commit squares fly to these (so they land on continents).
const landPts = [];
for (let y = MAP_Y + 4; y < MAP_Y + MAP_H; y += 7)
  for (let x = MAP_X + 4; x < MAP_X + MAP_W; x += 7)
    if (inLand(x, y)) landPts.push({ x, y });

// === SEEDED SHUFFLE (prevents row/column banding when assigning targets) ===
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
const shuffled = shuffle(landPts, mulberry32(seed));
const targets  = n === 0 ? [] : Array.from({ length: n }, (_, i) => shuffled[Math.floor(i * shuffled.length / n)]);

// === HELPERS ===
const gx = col => PAD_X + col * STEP;
const gy = row => GRID_Y + row * STEP;
const kt = (...ts) => ts.map(t => (+Math.max(0, Math.min(1, t / LOOP))).toFixed(5)).join(';');

// === BUILD SVG ===
function buildSvg({ id, bg, frame, gridEmpty, gridStroke, baseGreen, levels }) {
  // Watercolor filter: wobble coastlines (paper bleed) + tonal pooling + dark/light mottle,
  // all composited within the land silhouette.
  const filter = `<filter id="wc-${id}" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="3" seed="7" result="warp"/>
    <feDisplacementMap in="SourceGraphic" in2="warp" scale="16" xChannelSelector="R" yChannelSelector="G" result="land"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="2" seed="13" result="pool"/>
    <feColorMatrix in="pool" type="matrix" values="0 0 0 0 0.04 0 0 0 0 0.22 0 0 0 0 0.10 0.8 0 0 0 -0.28" result="poolc"/>
    <feComposite in="poolc" in2="land" operator="in" result="poolIn"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="4" seed="3" result="n1"/>
    <feColorMatrix in="n1" type="matrix" values="0 0 0 0 0.03 0 0 0 0 0.30 0 0 0 0 0.13 1.3 0 0 0 -0.55" result="dark"/>
    <feComposite in="dark" in2="land" operator="in" result="darkIn"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="3" seed="12" result="n2"/>
    <feColorMatrix in="n2" type="matrix" values="0 0 0 0 0.80 0 0 0 0 0.93 0 0 0 0 0.72 1.0 0 0 0 -0.5" result="lite"/>
    <feComposite in="lite" in2="land" operator="in" result="liteIn"/>
    <feMerge><feMergeNode in="land"/><feMergeNode in="poolIn"/><feMergeNode in="darkIn"/><feMergeNode in="liteIn"/></feMerge>
  </filter>`;

  // Grid: ghost cells that fade out as commits leave, fade back as they return.
  const gridCells = cells.map(c =>
    `<rect x="${gx(c.col)}" y="${gy(c.row)}" width="${DOT}" height="${DOT}" rx="2.4" fill="${gridEmpty}" stroke="${gridStroke}" stroke-width=".6"/>`
  ).join('');
  const gridGroup = `<g>
    <animate attributeName="opacity" values="1;1;0;0;1;1" keyTimes="${kt(0, GRID_END, G_OUT, BLOOM_GONE, G_IN, LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
    ${gridCells}
  </g>`;

  // Watercolor world map: solid base path (always renders) + filtered overlay (texture).
  // The whole group fades in once commits land, holds, then dissolves before they return.
  const mapGroup = `<g opacity="0">
    <animate attributeName="opacity" values="0;0;0.96;0.96;0;0" keyTimes="${kt(0, BLOOM_IN, BLOOM_END, MAP_HOLD, BLOOM_GONE, LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
    <path d="${LAND}" fill="${baseGreen}"/>
    <path d="${LAND}" fill="${baseGreen}" filter="url(#wc-${id})"/>
  </g>`;

  // Commit squares: fly grid -> land (linear), fade out as they're absorbed, then
  // re-form and fly home. LIFO reverse order (last to land is first to leave).
  const flyers = active.map((cell, i) => {
    const t   = targets[i] || { x: gx(cell.col) + DOT / 2, y: gy(cell.row) + DOT / 2 };
    const sx  = gx(cell.col), sy = gy(cell.row);
    const tx  = +(t.x - DOT / 2).toFixed(2), ty = +(t.y - DOT / 2).toFixed(2);
    const dep   = GRID_END + (i / Math.max(n - 1, 1)) * FLY_STAG;
    const arr   = dep + FLY_DUR;
    const gone  = arr + 0.4;
    const r_dep = BLOOM_GONE + ((n - 1 - i) / Math.max(n - 1, 1)) * FLY_STAG + 0.001;
    const r_vis = r_dep + 0.1;
    const r_arr = r_vis + FLY_BACK;
    const color = levels[cell.level] || levels.SECOND_QUARTILE;
    const T = kt(0, dep, arr, gone, MAP_HOLD, r_dep, r_vis, r_arr, LOOP);
    return `<rect x="${sx}" y="${sy}" width="${DOT}" height="${DOT}" rx="2.4" fill="${color}">
      <animate attributeName="x"       values="${sx};${sx};${tx};${tx};${tx};${tx};${tx};${sx};${sx}" keyTimes="${T}" dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="y"       values="${sy};${sy};${ty};${ty};${ty};${ty};${ty};${sy};${sy}" keyTimes="${T}" dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="opacity" values="1;1;0.45;0;0;0;0.9;1;1"                                  keyTimes="${T}" dur="${LOOP}s" repeatCount="indefinite"/>
    </rect>`;
  }).join('');

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub contributions flying in as paint to form a watercolor world map">
  <defs>${filter}</defs>
  <rect width="${W}" height="${H}" rx="20" fill="${bg}"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="19" stroke="${frame}" stroke-width="1.5"/>
  ${gridGroup}
  ${mapGroup}
  ${flyers}
</svg>`;
}

// === THEMES ===
const themes = {
  dark: {
    id: 'dark', bg: '#0d1117', frame: '#30363d',
    gridEmpty: '#161b22', gridStroke: '#21262d', baseGreen: '#2f9e4f',
    levels: { NONE: '#161b22', FIRST_QUARTILE: '#0e4429', SECOND_QUARTILE: '#006d32', THIRD_QUARTILE: '#26a641', FOURTH_QUARTILE: '#39d353' },
  },
  light: {
    id: 'light', bg: '#ffffff', frame: '#d0d7de',
    gridEmpty: '#ebedf0', gridStroke: '#d0d7de', baseGreen: '#2f9e4f',
    levels: { NONE: '#ebedf0', FIRST_QUARTILE: '#9be9a8', SECOND_QUARTILE: '#40c463', THIRD_QUARTILE: '#30a14e', FOURTH_QUARTILE: '#216e39' },
  },
};

await mkdir('dist', { recursive: true });
await writeFile('dist/github-contribution-grid-snake-dark.svg', buildSvg(themes.dark));
await writeFile('dist/github-contribution-grid-snake.svg',      buildSvg(themes.light));
console.log(`Watercolor world map: ${n} commits, ${landPts.length} land targets, land path ${(LAND.length/1024).toFixed(1)}KB.`);
