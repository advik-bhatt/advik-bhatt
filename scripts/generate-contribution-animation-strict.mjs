import { mkdir, writeFile } from 'node:fs/promises';

const USER = process.env.GITHUB_USER || 'advik-bhatt';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

// === CANVAS ===
const W = 847, H = 260;
const DOT = 11, STEP = 15, PAD_X = 28, GRID_Y = 72;
const MAP_DOT = 5;
const MAP_X = 58, MAP_Y = 26, MAP_W = 730, MAP_H = 204;

// === TIMING (seconds within a 24s loop) ===
// 0            grid shown
// GRID_HOLD    commits start flying
// FLY_END      all commits arrived at map positions
// WIRE_END     all border circuit traces fully drawn
// MAP_HOLD     map held; then everything fades back to grid
// LOOP         reset
const LOOP      = 24;
const GRID_HOLD = 4.5;
const FLY_END   = 9.2;
const WIRE_END  = 12.4;
const MAP_HOLD  = 20.0;
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

// === LAND MASK (improved continental coverage) ===
function isLand(lon, lat) {
  const e = (cx, cy, rx, ry) => ((lon - cx) / rx) ** 2 + ((lat - cy) / ry) ** 2 <= 1;
  if (e(-150, 63, 22, 11)) return true;  // Alaska
  if (e(-120, 56, 18, 12)) return true;  // W Canada
  if (e(-100, 50, 30, 14)) return true;  // Central N America
  if (e(-85, 42, 22, 12)) return true;   // E USA / SE Canada
  if (e(-88, 33, 12, 8))  return true;   // SE USA
  if (e(-102, 22, 14, 12)) return true;  // Mexico
  if (lon > -91 && lon < -77 && lat > 8 && lat < 18 && e(-84, 13, 10, 7)) return true;  // C. America
  if (e(-68, 8, 18, 8))   return true;   // Caribbean / N. S. America
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
  if (e(108, -2, 18, 6))  return true;   // Indonesia / Borneo
  if (e(137, 37, 4, 8))   return true;   // Japan
  if (e(134, -25, 24, 15)) return true;  // Australia
  if (e(-42, 72, 22, 12)) return true;   // Greenland
  if (e(-19, 65, 6, 4))   return true;   // Iceland
  return false;
}

// === LAND SAMPLE GRID ===
const landGrid = [];
for (let lat = 73; lat >= -52; lat -= 7) {
  for (let lon = -174; lon <= 175; lon += 9) {
    if (!isLand(lon, lat)) continue;
    const p = proj(lon, lat);
    landGrid.push({ x: p.x, y: p.y });
  }
}

// === SEEDED SHUFFLE (breaks row/column visual artifact) ===
// Without this, sorted commits map to sorted land points, creating visible grid bands.
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
const shuffledLand = shuffle(landGrid, rng);

function getTargets(count) {
  if (!count || !shuffledLand.length) return [];
  return Array.from({ length: count }, (_, i) => {
    const idx = Math.round((i / Math.max(count - 1, 1)) * (shuffledLand.length - 1));
    return shuffledLand[idx];
  });
}
const targets = getTargets(active.length);

// === WORLD MAP GEOGRAPHIC BORDER DATA ===
// Simplified Natural Earth polylines at ~3-5 degree precision.
// Each array is a [lon, lat] sequence forming a coastline or border segment.
const GEO_LINES = [
  // North America west coast
  [[-168,71],[-155,59],[-152,58],[-145,60],[-135,57],[-127,50],[-124,49],[-117,32],[-110,23]],
  // North America east coast
  [[-80,25],[-80,31],[-76,35],[-75,40],[-70,44],[-67,47],[-64,44],[-60,47],[-54,47]],
  // Canada arctic / Great Lakes top
  [[-60,47],[-65,44],[-70,47],[-75,45],[-79,44],[-83,46],[-87,45],[-87,42],[-95,47],[-100,49],[-110,49],[-120,49],[-127,50]],
  // US-Canada 49th parallel
  [[-123,49],[-110,49],[-100,49],[-95,49],[-88,49],[-83,46],[-76,44]],
  // US-Mexico border
  [[-117,32],[-110,31],[-105,30],[-100,29],[-97,26]],
  // Mexico & Central America
  [[-97,26],[-92,20],[-90,18],[-87,16],[-84,10],[-80,8]],
  // Gulf coast
  [[-97,26],[-90,30],[-83,30],[-82,29],[-80,27],[-80,25]],
  // Greenland
  [[-55,83],[-22,76],[-18,70],[-25,63],[-45,59],[-55,63],[-65,70],[-72,76],[-55,83]],
  // Iceland
  [[-25,64],[-22,64],[-13,65],[-14,67],[-22,66],[-25,64]],
  // South America north coast
  [[-80,8],[-75,11],[-62,11],[-51,4],[-50,-1],[-45,-1],[-35,-5]],
  // South America east coast
  [[-35,-5],[-35,-8],[-38,-13],[-40,-19],[-43,-23],[-48,-26],[-50,-29],[-53,-33],[-58,-38],[-63,-42],[-65,-46],[-66,-55]],
  // South America west coast
  [[-80,8],[-80,-2],[-74,-10],[-70,-18],[-70,-30],[-72,-38],[-74,-45],[-66,-55]],
  // Andes border (interior)
  [[-70,-18],[-68,-22],[-65,-22],[-62,-22],[-58,-20],[-58,-33]],
  // Amazon
  [[-73,-5],[-68,-4],[-60,-2],[-50,-1]],
  // Europe Atlantic coast
  [[-10,36],[-9,39],[-8,44],[-3,44],[3,44],[5,48],[8,47],[12,46],[14,46],[16,47]],
  // Europe east / Baltic
  [[16,47],[19,48],[22,48],[25,46],[28,46],[30,45],[30,42]],
  // UK & Ireland
  [[-10,52],[-8,52],[-5,50],[-3,51],[2,53],[2,55],[0,57],[-3,58],[-5,56],[-4,52],[-3,51],[-5,50]],
  // Scandinavia
  [[5,58],[8,58],[14,57],[18,57],[20,59],[25,60],[28,60],[30,65],[25,71],[17,70],[15,65],[13,63],[8,63],[5,59]],
  // Iberian Peninsula
  [[-9,44],[-9,36],[-6,36],[-5,36],[-2,37],[0,38],[3,41],[3,44],[-3,44],[-8,44],[-9,44]],
  // France-Germany-Alps
  [[3,44],[5,44],[8,47],[10,48],[15,50],[14,51],[14,54],[10,55],[8,55],[8,47]],
  // Italy
  [[8,44],[10,44],[12,44],[14,40],[16,38],[15,38],[14,40],[12,44]],
  // Balkans / Greece
  [[16,47],[18,46],[20,42],[22,40],[24,38],[26,39],[28,40],[30,42],[28,46]],
  // Black Sea / Turkey
  [[28,42],[36,37],[42,37],[44,40],[42,42],[36,43],[30,43],[28,43]],
  // Africa north coast
  [[-6,36],[3,37],[10,37],[16,37],[25,35],[32,31],[36,30],[37,22],[43,12]],
  // Africa west coast
  [[-16,15],[-14,11],[-10,8],[-8,5],[-2,5],[3,5],[10,4]],
  // Africa central / SE
  [[10,4],[14,-2],[15,-10],[18,-17],[22,-18],[28,-20],[32,-18],[34,-12]],
  // Africa south coast
  [[34,-12],[36,-20],[34,-26],[30,-30],[18,-34],[16,-35],[14,-33],[18,-34],[28,-33],[32,-24],[34,-12]],
  // Africa Horn / east coast
  [[36,30],[37,22],[43,12],[45,10],[44,12],[37,15],[37,12],[32,10],[30,12],[25,20]],
  // Sahel line
  [[-16,15],[0,14],[10,13],[22,13],[30,12],[37,12]],
  // Nile
  [[32,30],[32,22],[34,12],[36,6],[37,4],[40,-2]],
  // Congo river
  [[15,-5],[18,-5],[24,-5],[28,-2],[30,0]],
  // Arabia / Middle East
  [[37,30],[37,22],[44,22],[50,24],[56,24],[58,22],[56,14],[44,12],[37,12]],
  // Iraq / Iran
  [[37,37],[44,37],[47,38],[48,30],[56,26],[60,24],[62,26]],
  // India west coast
  [[60,24],[68,24],[73,8],[76,8],[80,8]],
  // India east coast
  [[80,8],[82,14],[80,22],[78,28],[74,34],[70,36]],
  // India-Pakistan border
  [[60,24],[62,26],[66,28],[70,30],[74,34]],
  // Russia north coast
  [[32,70],[40,69],[55,68],[72,68],[90,72],[105,72],[120,73],[130,68],[140,60]],
  // Russia Pacific coast
  [[140,60],[135,47],[135,43],[140,45],[143,50],[148,55],[155,55],[162,60],[170,65],[175,68]],
  // Russia-Europe Urals
  [[60,54],[60,62],[62,68],[68,70],[72,68]],
  // Kazakhstan
  [[52,42],[52,52],[58,54],[68,54],[80,50],[80,42],[70,38],[56,38],[52,42]],
  // China south
  [[74,34],[78,34],[86,28],[92,28],[100,22],[104,18],[110,20],[116,24]],
  // China east coast
  [[116,24],[121,24],[122,32],[121,38],[120,40],[122,48],[128,50],[130,47],[135,47]],
  // China north / Mongolia
  [[74,36],[86,42],[92,46],[100,50],[110,50],[114,48],[120,42],[130,42],[135,47]],
  // Korea
  [[124,38],[126,34],[129,35],[129,38],[126,38],[124,38]],
  // Japan (Honshu + Hokkaido)
  [[130,32],[135,34],[138,36],[140,38],[142,40],[145,44],[141,43],[140,40],[140,36],[137,35],[135,35],[132,34],[130,32]],
  // SE Asia mainland
  [[100,4],[104,0],[104,-2],[108,-2],[115,0],[118,4],[120,10],[120,20],[116,24]],
  // Indonesia / Borneo
  [[105,-6],[108,-7],[112,-8],[115,-8],[117,-5],[120,-4],[118,4],[115,5],[110,2],[108,-2],[105,-4],[105,-6]],
  // Mekong
  [[100,28],[100,22],[102,18],[104,14],[104,10],[104,4]],
  // Yangtze
  [[90,28],[96,32],[100,30],[106,30],[110,30],[116,30],[121,32]],
  // Mississippi
  [[-90,47],[-92,42],[-90,36],[-89,32],[-90,30]],
  // Australia north
  [[114,-22],[122,-18],[128,-14],[136,-12],[140,-11],[142,-11],[146,-18],[150,-22],[152,-24],[154,-28]],
  // Australia south
  [[154,-28],[152,-32],[150,-38],[148,-40],[142,-38],[140,-36],[136,-35],[130,-32],[116,-32],[114,-26],[114,-22]],
  // New Zealand
  [[172,-34],[170,-37],[168,-43],[170,-46],[172,-44],[174,-42],[176,-38],[178,-38],[176,-37],[174,-36],[172,-34]],
  // Madagascar
  [[44,-12],[47,-14],[50,-16],[50,-22],[46,-25],[44,-20],[44,-12]],
];

const borderPaths = GEO_LINES.map(coords =>
  coords.map((p, i) => {
    const { x, y } = proj(p[0], p[1]);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ')
);

// === SVG HELPERS ===
const gx = col => PAD_X + col * STEP;
const gy = row => GRID_Y + row * STEP;
const kt = (...ts) => ts.map(t => Math.max(0, Math.min(1, t / LOOP)).toFixed(5)).join(';');

// === BUILD SVG ===
function buildSvg(theme) {
  const { id, bg, frame, ocean, gridEmpty, gridStroke, levels, traceColor, glowColor } = theme;

  const gridCells = cells.map(c =>
    `<rect x="${gx(c.col)}" y="${gy(c.row)}" width="${DOT}" height="${DOT}" rx="2.4" fill="${gridEmpty}" stroke="${gridStroke}" stroke-width=".6"/>`
  ).join('');

  const gridGroup = `<g>
    <animate attributeName="opacity" values="1;1;0.07;0.07;1" keyTimes="${kt(0, GRID_HOLD, FLY_END, MAP_HOLD, LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
    ${gridCells}
  </g>`;

  const commitSquares = active.map((cell, i) => {
    const t = targets[i] || { x: gx(cell.col), y: gy(cell.row) };
    const sx = gx(cell.col);
    const sy = gy(cell.row);
    const tx = +t.x.toFixed(2);
    const ty = +t.y.toFixed(2);
    const depart = +(GRID_HOLD + (i / Math.max(active.length - 1, 1)) * 1.8).toFixed(3);
    const arrive = +Math.min(depart + 2.8, FLY_END + 0.5).toFixed(3);
    const pop    = +(arrive + 0.10).toFixed(3);
    const color  = levels[cell.level] || levels.SECOND_QUARTILE;
    return `<rect x="${sx}" y="${sy}" width="${DOT}" height="${DOT}" rx="2.4" fill="${color}">
      <animate attributeName="x" values="${sx};${sx};${tx};${tx};${sx}" keyTimes="${kt(0,depart,arrive,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="y" values="${sy};${sy};${ty};${ty};${sy}" keyTimes="${kt(0,depart,arrive,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="width" values="${DOT};${DOT};${MAP_DOT};${MAP_DOT};${DOT}" keyTimes="${kt(0,depart,arrive,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
      <animate attributeName="height" values="${DOT};${DOT};${MAP_DOT};${MAP_DOT};${DOT}" keyTimes="${kt(0,depart,arrive,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
      <animate attributeName="rx" values="2.4;2.4;1.5;1.5;2.4" keyTimes="${kt(0,depart,arrive,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="1;1;0.3;1;0.8;0" keyTimes="${kt(0,depart,arrive,pop,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
    </rect>`;
  }).join('');

  const glowLayer = borderPaths.map((d, i) => {
    const spread = (i / borderPaths.length) * 2.6;
    const drawS  = +(FLY_END + spread * 0.36).toFixed(3);
    const drawE  = +Math.min(drawS + 1.6, WIRE_END).toFixed(3);
    return `<path d="${d}" stroke="${glowColor}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1200" stroke-dashoffset="1200">
      <animate attributeName="stroke-dashoffset" values="1200;1200;0;0;1200" keyTimes="${kt(0,drawS,drawE,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="opacity" values="0;0;0.20;0.12;0" keyTimes="${kt(0,drawS,drawE,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
    </path>`;
  }).join('');

  const traceLayer = borderPaths.map((d, i) => {
    const spread = (i / borderPaths.length) * 2.6;
    const drawS  = +(FLY_END + spread * 0.36).toFixed(3);
    const drawE  = +Math.min(drawS + 1.6, WIRE_END).toFixed(3);
    return `<path d="${d}" stroke="${traceColor}" stroke-width="0.85" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1200" stroke-dashoffset="1200">
      <animate attributeName="stroke-dashoffset" values="1200;1200;0;0;1200" keyTimes="${kt(0,drawS,drawE,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="opacity" values="0;0;0.72;0.52;0" keyTimes="${kt(0,drawS,drawE,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
    </path>`;
  }).join('');

  const hLines = Array.from({ length: 13 }, (_, i) => {
    const y = (MAP_Y + (i / 12) * MAP_H).toFixed(1);
    return `<line x1="${MAP_X}" y1="${y}" x2="${MAP_X + MAP_W}" y2="${y}" stroke="${traceColor}" stroke-width="0.35"/>`;
  }).join('');
  const vLines = Array.from({ length: 21 }, (_, i) => {
    const x = (MAP_X + (i / 20) * MAP_W).toFixed(1);
    return `<line x1="${x}" y1="${MAP_Y}" x2="${x}" y2="${MAP_Y + MAP_H}" stroke="${traceColor}" stroke-width="0.35"/>`;
  }).join('');
  const gridOverlay = `<g>
    <animate attributeName="opacity" values="0;0;0.04;0.025;0" keyTimes="${kt(0, FLY_END, WIRE_END, MAP_HOLD, LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
    ${hLines}${vLines}
  </g>`;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub contributions animating into a world circuit map">
  <defs>
    <linearGradient id="ocean-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="${ocean[0]}"/>
      <stop offset="1" stop-color="${ocean[1]}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="20" fill="${bg}"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="19" stroke="${frame}" stroke-width="1.5"/>
  <rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="13" fill="url(#ocean-${id})"/>
  ${gridOverlay}
  ${gridGroup}
  ${commitSquares}
  <g>${glowLayer}</g>
  <g>${traceLayer}</g>
</svg>`;
}

// Dark  — "Cyber Atlas": deep navy ocean, GitHub green nodes, cyan circuit traces
// Light — "Blueprint":   soft blue ocean, forest green nodes, indigo circuit traces
const themes = {
  dark: {
    id: 'dark',
    bg: '#040d1b',
    frame: '#0f2d4a',
    ocean: ['#070f1e', '#0a1628'],
    gridEmpty: '#0d1a2e',
    gridStroke: '#162338',
    levels: {
      NONE:            '#0d1a2e',
      FIRST_QUARTILE:  '#0e4429',
      SECOND_QUARTILE: '#006d32',
      THIRD_QUARTILE:  '#26a641',
      FOURTH_QUARTILE: '#39d353',
    },
    traceColor: '#0891b2',
    glowColor:  '#22d3ee',
  },
  light: {
    id: 'light',
    bg: '#f0f4f8',
    frame: '#94a3b8',
    ocean: ['#dbeafe', '#bfdbfe'],
    gridEmpty: '#ebedf0',
    gridStroke: '#d1d5db',
    levels: {
      NONE:            '#ebedf0',
      FIRST_QUARTILE:  '#9be9a8',
      SECOND_QUARTILE: '#40c463',
      THIRD_QUARTILE:  '#30a14e',
      FOURTH_QUARTILE: '#216e39',
    },
    traceColor: '#1e40af',
    glowColor:  '#3b82f6',
  },
};

await mkdir('dist', { recursive: true });
await writeFile('dist/github-contribution-grid-snake-dark.svg', buildSvg(themes.dark));
await writeFile('dist/github-contribution-grid-snake.svg', buildSvg(themes.light));
console.log(`Cyber Atlas: ${active.length} commits, ${shuffledLand.length} land targets, ${borderPaths.length} border traces.`);
