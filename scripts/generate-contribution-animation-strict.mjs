import { mkdir, writeFile } from 'node:fs/promises';

const USER = process.env.GITHUB_USER || 'advik-bhatt';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

// === CANVAS ===
const W = 847, H = 260;
const DOT = 11, STEP = 15, PAD_X = 28, GRID_Y = 72;
const MAP_DOT = 5;
const MAP_X = 58, MAP_Y = 26, MAP_W = 730, MAP_H = 204;

// === TIMING (seconds in a 24s loop) ===
const LOOP      = 24;
const GRID_HOLD = 4.5;   // grid shown solid
const FLY_START = 4.5;   // commits begin departing
const FLY_END   = 9.2;   // last commit arrives
const WIRE_END  = 12.4;  // all border traces fully drawn
const MAP_HOLD  = 20.0;  // map held until reset
const DAY = 86400000;

// === GITHUB DATA ===
const Q = `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{contributionCount contributionLevel date weekday}}}}}}}`;
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

// === PROJECTION (equirectangular) ===
function proj(lon, lat) {
  return {
    x: MAP_X + ((lon + 180) / 360) * MAP_W,
    y: MAP_Y + ((90 - lat) / 180) * MAP_H,
  };
}

// === LAND MASK ===
function isLand(lon, lat) {
  const e = (cx, cy, rx, ry) => ((lon - cx) / rx) ** 2 + ((lat - cy) / ry) ** 2 <= 1;
  // Alaska / NW Canada
  if (e(-150, 63, 22, 11)) return true;
  // Western Canada / Pacific NW
  if (e(-120, 56, 18, 12)) return true;
  // Central North America
  if (e(-100, 50, 30, 14)) return true;
  // Eastern USA / SE Canada
  if (e(-85, 42, 22, 12)) return true;
  // SE USA
  if (e(-88, 33, 12, 8)) return true;
  // Mexico
  if (e(-102, 22, 14, 12)) return true;
  // Central America
  if (lon > -91 && lon < -77 && lat > 8 && lat < 18 && e(-84, 13, 10, 7)) return true;
  // Caribbean / north South America
  if (e(-68, 8, 18, 8)) return true;
  // South America main
  if (e(-60, -12, 28, 44)) return true;
  // SE South America (Argentina)
  if (e(-65, -40, 10, 16)) return true;
  // Western Europe
  if (e(8, 50, 22, 12)) return true;
  // Eastern Europe
  if (e(28, 52, 18, 12)) return true;
  // Iberian
  if (e(-4, 40, 8, 6)) return true;
  // Italian boot
  if (e(13, 42, 5, 9)) return true;
  // Greece / Balkans
  if (e(22, 40, 7, 6)) return true;
  // UK
  if (e(-2, 54, 5, 6)) return true;
  // Scandinavia
  if (lon > 5 && lon < 32 && lat > 56 && lat < 71 && e(18, 63, 14, 9)) return true;
  // North Africa
  if (e(18, 26, 32, 16)) return true;
  // West Africa
  if (e(4, 10, 20, 14)) return true;
  // East Africa / Horn
  if (e(36, 6, 16, 20)) return true;
  // Southern Africa
  if (e(25, -22, 16, 18)) return true;
  // Madagascar
  if (e(46, -20, 4, 10)) return true;
  // Arabia / Middle East
  if (e(44, 24, 16, 12)) return true;
  // Turkey / Caucasus
  if (e(36, 39, 12, 6)) return true;
  // Iran / Afghanistan
  if (e(56, 32, 16, 10)) return true;
  // Russia west
  if (e(50, 58, 30, 10)) return true;
  // Russia central
  if (e(90, 60, 36, 10)) return true;
  // Russia east / Siberia
  if (e(140, 60, 26, 12)) return true;
  // Central Asia (Kazakhstan)
  if (e(68, 46, 18, 10)) return true;
  // India
  if (e(78, 22, 14, 16)) return true;
  // Sri Lanka
  if (e(81, 8, 2, 2)) return true;
  // China main
  if (e(104, 36, 30, 18)) return true;
  // Northeast China / Korea
  if (e(122, 38, 10, 10)) return true;
  // Southeast Asia mainland
  if (e(104, 16, 18, 14)) return true;
  // Philippines
  if (e(122, 12, 4, 10)) return true;
  // Indonesia / Borneo
  if (e(108, -2, 18, 6)) return true;
  // Java
  if (e(110, -7, 7, 3)) return true;
  // Japan
  if (e(137, 37, 4, 8)) return true;
  // Hokkaido
  if (e(143, 43, 4, 4)) return true;
  // Australia
  if (e(134, -25, 24, 15)) return true;
  // New Zealand (north)
  if (e(175, -38, 3, 5)) return true;
  // New Zealand (south)
  if (e(170, -44, 3, 5)) return true;
  // Greenland
  if (e(-42, 72, 22, 12)) return true;
  // Iceland
  if (e(-19, 65, 6, 4)) return true;
  return false;
}

// === BUILD LAND SAMPLE GRID ===
const landGrid = [];
for (let lat = 73; lat >= -52; lat -= 7) {
  for (let lon = -174; lon <= 175; lon += 9) {
    if (!isLand(lon, lat)) continue;
    const p = proj(lon, lat);
    landGrid.push({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
  }
}

// === SEEDED RNG + SHUFFLE (fixes row/column visual artifact) ===
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
// Shuffle the land targets so commits don't map in sorted order (prevents row/column patterns)
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
// Each sub-array is a sequence of [lon, lat] points forming a polyline.
// Sources: simplified Natural Earth coastlines & borders at ~3-5° precision.
const GEO_LINES = [
  // — NORTH AMERICA west coast —
  [[-168,71],[-155,59],[-152,58],[-145,60],[-135,57],[-127,50],[-124,49],[-117,32],[-110,23]],
  // — NORTH AMERICA east coast —
  [[-80,25],[-80,31],[-76,35],[-75,40],[-70,44],[-67,47],[-64,44],[-60,47],[-54,47]],
  // — NORTH AMERICA north (Canada arctic) —
  [[-60,47],[-65,44],[-70,47],[-75,45],[-79,44],[-83,46],[-87,45],[-87,42],[-95,47],[-100,49],[-110,49],[-120,49],[-127,50]],
  // — US–Canada 49th parallel (rough) —
  [[-123,49],[-110,49],[-100,49],[-95,49],[-88,49],[-83,46],[-76,44]],
  // — US–Mexico border —
  [[-117,32],[-110,31],[-105,30],[-100,29],[-97,26]],
  // — Mexico & Central America —
  [[-97,26],[-92,20],[-90,18],[-87,16],[-84,10],[-80,8]],
  // — Gulf coast —
  [[-97,26],[-90,30],[-83,30],[-82,29],[-80,27],[-80,25]],
  // — Florida / SE coast —
  [[-80,25],[-80,27],[-81,31],[-80,32],[-76,35]],
  // — Greenland —
  [[-55,83],[-22,76],[-18,70],[-25,63],[-45,59],[-55,63],[-65,70],[-72,76],[-55,83]],
  // — Iceland —
  [[-25,64],[-22,64],[-13,65],[-14,67],[-22,66],[-25,64]],
  // — SOUTH AMERICA north coast —
  [[-80,8],[-75,11],[-62,11],[-51,4],[-50,-1],[-45,-1],[-35,-5]],
  // — SOUTH AMERICA east coast —
  [[-35,-5],[-35,-8],[-38,-13],[-40,-19],[-43,-23],[-48,-26],[-50,-29],[-53,-33],[-58,-38],[-63,-42],[-65,-46],[-66,-55]],
  // — SOUTH AMERICA west coast —
  [[-80,8],[-80,-2],[-74,-10],[-70,-18],[-70,-30],[-72,-38],[-74,-45],[-66,-55]],
  // — Andes (Peru/Bolivia/Argentina border) —
  [[-70,-18],[-68,-22],[-65,-22],[-62,-22],[-58,-20],[-58,-33]],
  // — Amazon river (simplified) —
  [[-73,-5],[-68,-4],[-60,-2],[-50,-1]],
  // — EUROPE north coast / Atlantic —
  [[-10,36],[-9,39],[-8,44],[-3,44],[3,44],[5,48],[8,47],[12,46],[14,46],[16,47]],
  // — EUROPE east coast / Baltic —
  [[16,47],[19,48],[22,48],[25,46],[28,46],[30,45],[30,42]],
  // — EUROPE NW (UK Ireland) —
  [[-10,52],[-8,52],[-5,50],[-3,51],[2,53],[2,55],[0,57],[-3,58],[-5,56],[-4,52],[-3,51],[-5,50]],
  // — Scandinavia —
  [[5,58],[8,58],[14,57],[18,57],[20,59],[25,60],[28,60],[30,65],[25,71],[17,70],[15,65],[13,63],[8,63],[5,59]],
  // — Iberian Peninsula —
  [[-9,44],[-9,36],[-6,36],[-5,36],[-2,37],[0,38],[3,41],[3,44],[-3,44],[-8,44],[-9,44]],
  // — France / Alps / Germany border —
  [[3,44],[5,44],[8,47],[10,48],[15,50],[14,51],[14,54],[10,55],[8,55],[8,47]],
  // — Italy —
  [[8,44],[10,44],[12,44],[14,40],[16,38],[15,38],[14,40],[12,44]],
  // — Balkans / Greece —
  [[16,47],[18,46],[20,42],[22,40],[24,38],[26,39],[28,40],[30,42],[28,46]],
  // — Black Sea / Turkey —
  [[28,42],[36,37],[36,37],[42,37],[44,40],[42,42],[36,43],[30,43],[28,43]],
  // — AFRICA north coast —
  [[-6,36],[3,37],[10,37],[16,37],[25,35],[32,31],[36,30],[37,22],[43,12]],
  // — AFRICA west coast —
  [[-16,15],[-14,11],[-10,8],[-8,5],[-2,5],[3,5],[10,4]],
  // — AFRICA central / east —
  [[10,4],[14,-2],[15,-10],[18,-17],[22,-18],[28,-20],[32,-18],[34,-12]],
  // — AFRICA south & east coast —
  [[34,-12],[36,-20],[34,-26],[30,-30],[18,-34],[16,-35],[14,-33],[18,-34],[28,-33],[32,-24],[34,-12]],
  // — AFRICA Horn / east coast —
  [[36,30],[37,22],[43,12],[45,10],[44,12],[37,15],[37,12],[32,10],[30,12],[25,20]],
  // — Sahel / trans-Saharan line —
  [[-16,15],[0,14],[10,13],[22,13],[30,12],[37,12]],
  // — Nile (simplified) —
  [[32,30],[32,22],[34,12],[36,6],[37,4],[40,-2]],
  // — Congo river —
  [[15,-5],[18,-5],[24,-5],[28,-2],[30,0]],
  // — ARABIA / MIDDLE EAST —
  [[37,30],[37,22],[44,22],[50,24],[56,24],[58,22],[56,14],[44,12],[37,12]],
  // — Iraq / Iran / Gulf —
  [[37,37],[44,37],[47,38],[48,30],[56,26],[60,24],[62,26]],
  // — INDIA west coast —
  [[60,24],[68,24],[73,8],[76,8],[80,8]],
  // — INDIA east coast + Sri Lanka —
  [[80,8],[82,14],[80,22],[78,28],[74,34],[70,36]],
  // — India-Pakistan border —
  [[60,24],[62,26],[66,28],[70,30],[74,34]],
  // — RUSSIA north coast (simplified) —
  [[32,70],[40,69],[55,68],[72,68],[90,72],[105,72],[120,73],[130,68],[140,60]],
  // — RUSSIA Pacific coast —
  [[140,60],[135,47],[135,43],[140,45],[143,50],[148,55],[155,55],[162,60],[170,65],[175,68]],
  // — Russia / Europe border (Urals) —
  [[60,54],[60,62],[62,68],[68,70],[72,68]],
  // — CENTRAL ASIA (Kazakhstan) —
  [[52,42],[52,52],[58,54],[68,54],[80,50],[80,42],[70,38],[56,38],[52,42]],
  // — CHINA south border —
  [[74,34],[78,34],[86,28],[92,28],[100,22],[104,18],[110,20],[116,24]],
  // — CHINA east coast —
  [[116,24],[121,24],[122,32],[121,38],[120,40],[122,48],[128,50],[130,47],[135,47]],
  // — CHINA north / Mongolia —
  [[74,36],[86,42],[92,46],[100,50],[110,50],[114,48],[120,42],[130,42],[135,47]],
  // — KOREA —
  [[124,38],[126,34],[129,35],[129,38],[126,38],[124,38]],
  // — JAPAN (Honshu) —
  [[130,32],[135,34],[138,36],[140,38],[142,40],[145,44],[141,43],[140,40],[140,36],[137,35],[135,35],[132,34],[130,32]],
  // — SOUTHEAST ASIA mainland —
  [[100,4],[104,0],[104,-2],[108,-2],[115,0],[118,4],[120,10],[120,20],[116,24]],
  // — Indonesia / Borneo —
  [[105,-6],[108,-7],[112,-8],[115,-8],[117,-5],[120,-4],[118,4],[115,5],[110,2],[108,-2],[105,-4],[105,-6]],
  // — Mekong (simplified) —
  [[100,28],[100,22],[102,18],[104,14],[104,10],[104,4]],
  // — Yangtze river (simplified) —
  [[90,28],[96,32],[100,30],[106,30],[110,30],[116,30],[121,32]],
  // — Yellow River (simplified) —
  [[96,36],[100,38],[108,40],[110,38],[116,38],[120,38]],
  // — Mississippi (simplified) —
  [[-90,47],[-92,42],[-90,36],[-89,32],[-90,30]],
  // — AUSTRALIA north —
  [[114,-22],[122,-18],[128,-14],[136,-12],[140,-11],[142,-11],[146,-18],[150,-22],[152,-24],[154,-28]],
  // — AUSTRALIA east & south —
  [[154,-28],[152,-32],[150,-38],[148,-40],[142,-38],[140,-36],[136,-35],[130,-32],[116,-32],[114,-26],[114,-22]],
  // — NEW ZEALAND —
  [[172,-34],[170,-37],[168,-43],[170,-46],[172,-44],[174,-42],[176,-38],[178,-38],[176,-37],[174,-36],[172,-34]],
  // — MADAGASCAR —
  [[44,-12],[47,-14],[50,-16],[50,-22],[46,-25],[44,-20],[44,-12]],
];

// Project geo line to SVG path string
function geoPath(coords) {
  return coords.map((p, i) => {
    const { x, y } = proj(p[0], p[1]);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}
const borderPaths = GEO_LINES.map(geoPath);

// === SVG HELPERS ===
const gx = col => PAD_X + col * STEP;
const gy = row => GRID_Y + row * STEP;
const f = n => +n.toFixed(3);
const kt = (...ts) => ts.map(t => f(Math.max(0, Math.min(1, t / LOOP)))).join(';');

// === BUILD SVG ===
function buildSvg(theme) {
  const { id, bg, frame, ocean, gridEmpty, gridStroke, levels, traceColor, glowColor, dotGlow } = theme;

  // Background grid cells
  const gridCells = cells.map(c =>
    `<rect x="${gx(c.col)}" y="${gy(c.row)}" width="${DOT}" height="${DOT}" rx="2.4" fill="${gridEmpty}" stroke="${gridStroke}" stroke-width=".6"/>`
  ).join('');

  // Grid group fades to ghost during map phase
  const gridGroup = `<g>
    <animate attributeName="opacity" values="1;1;0.08;0.08;1" keyTimes="${kt(0, GRID_HOLD, FLY_END, MAP_HOLD, LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
    ${gridCells}
  </g>`;

  // Commit squares: linear flight from grid → map position, then pop-collapse to dot
  const commitSquares = active.map((cell, i) => {
    const t = targets[i] || { x: gx(cell.col), y: gy(cell.row) };
    const sx = gx(cell.col);
    const sy = gy(cell.row);
    // center-aligned coordinates during flight and at rest
    const fax = f(t.x - (DOT - MAP_DOT) / 2);  // x when arrived (DOT size, centered on target)
    const fay = f(t.y - (DOT - MAP_DOT) / 2);
    const tx = f(t.x);  // x as MAP_DOT
    const ty = f(t.y);
    // Stagger start across the full FLY window so wave feels continuous
    const depart = f(FLY_START + (i / Math.max(active.length - 1, 1)) * 1.6);
    const arrive = f(Math.min(depart + 2.8, FLY_END + 0.4));
    const pop    = f(arrive + 0.08);
    const settle = f(arrive + 0.28);
    const color = levels[cell.level] || levels.SECOND_QUARTILE;

    return `<rect x="${sx}" y="${sy}" width="${DOT}" height="${DOT}" rx="2.4" fill="${color}">
      <animate attributeName="x"
        values="${sx};${sx};${fax};${fax};${tx};${tx};${sx}"
        keyTimes="${kt(0, depart, arrive, arrive, pop, settle, MAP_HOLD, LOOP).split(';').slice(0,7).join(';')};${f(MAP_HOLD/LOOP)};${f(LOOP/LOOP)}"
        dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="y"
        values="${sy};${sy};${fay};${fay};${ty};${ty};${sy}"
        keyTimes="${kt(0, depart, arrive, arrive, pop, settle, MAP_HOLD, LOOP).split(';').slice(0,7).join(';')};${f(MAP_HOLD/LOOP)};${f(LOOP/LOOP)}"
        dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="width"
        values="${DOT};${DOT};${DOT};${MAP_DOT + 4};${MAP_DOT};${MAP_DOT};${DOT}"
        keyTimes="${kt(0, depart, arrive, pop, settle, MAP_HOLD, LOOP)}"
        dur="${LOOP}s" repeatCount="indefinite"/>
      <animate attributeName="height"
        values="${DOT};${DOT};${DOT};${MAP_DOT + 4};${MAP_DOT};${MAP_DOT};${DOT}"
        keyTimes="${kt(0, depart, arrive, pop, settle, MAP_HOLD, LOOP)}"
        dur="${LOOP}s" repeatCount="indefinite"/>
      <animate attributeName="rx"
        values="2.4;2.4;2.4;1.0;1.2;1.2;2.4"
        keyTimes="${kt(0, depart, arrive, pop, settle, MAP_HOLD, LOOP)}"
        dur="${LOOP}s" repeatCount="indefinite"/>
      <animate attributeName="opacity"
        values="1;1;1;0.4;1;0.85;0"
        keyTimes="${kt(0, depart, arrive, pop, settle, MAP_HOLD, LOOP)}"
        dur="${LOOP}s" repeatCount="indefinite"/>
    </rect>`;
  }).join('');

  // Country / coastline border traces — drawn as circuit lines via stroke-dashoffset
  // Glow layer (wider, more transparent)
  const glowLayer = borderPaths.map((d, i) => {
    const spread = (i / borderPaths.length) * 2.4;
    const drawS = f(FLY_END + spread * 0.35);
    const drawE = f(Math.min(drawS + 1.5, WIRE_END));
    return `<path d="${d}" stroke="${glowColor}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"
      stroke-dasharray="1200" stroke-dashoffset="1200">
      <animate attributeName="stroke-dashoffset"
        values="1200;1200;0;0;1200"
        keyTimes="${kt(0, drawS, drawE, MAP_HOLD, LOOP)}"
        dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="opacity"
        values="0;0;0.22;0.14;0"
        keyTimes="${kt(0, drawS, drawE, MAP_HOLD, LOOP)}"
        dur="${LOOP}s" repeatCount="indefinite"/>
    </path>`;
  }).join('');

  // Sharp trace layer
  const traceLayer = borderPaths.map((d, i) => {
    const spread = (i / borderPaths.length) * 2.4;
    const drawS = f(FLY_END + spread * 0.35);
    const drawE = f(Math.min(drawS + 1.5, WIRE_END));
    return `<path d="${d}" stroke="${traceColor}" stroke-width="0.9" fill="none" stroke-linecap="round" stroke-linejoin="round"
      stroke-dasharray="1200" stroke-dashoffset="1200">
      <animate attributeName="stroke-dashoffset"
        values="1200;1200;0;0;1200"
        keyTimes="${kt(0, drawS, drawE, MAP_HOLD, LOOP)}"
        dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="opacity"
        values="0;0;0.75;0.55;0"
        keyTimes="${kt(0, drawS, drawE, MAP_HOLD, LOOP)}"
        dur="${LOOP}s" repeatCount="indefinite"/>
    </path>`;
  }).join('');

  // Scanline / grid overlay visible only during map phase (adds circuit-board feel)
  const gridOverlay = `<g>
    <animate attributeName="opacity" values="0;0;0.035;0.025;0" keyTimes="${kt(0, FLY_END, WIRE_END, MAP_HOLD, LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>
    ${Array.from({ length: 14 }, (_, i) => {
      const y = f(MAP_Y + (i / 13) * MAP_H);
      return `<line x1="${MAP_X}" y1="${y}" x2="${MAP_X + MAP_W}" y2="${y}" stroke="${traceColor}" stroke-width="0.4"/>`;
    }).join('')}
    ${Array.from({ length: 22 }, (_, i) => {
      const x = f(MAP_X + (i / 21) * MAP_W);
      return `<line x1="${x}" y1="${MAP_Y}" x2="${x}" y2="${MAP_Y + MAP_H}" stroke="${traceColor}" stroke-width="0.4"/>`;
    }).join('')}
  </g>`;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub contribution calendar animating into a world map circuit">
  <defs>
    <linearGradient id="ocean-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="${ocean[0]}"/>
      <stop offset="1" stop-color="${ocean[1]}"/>
    </linearGradient>
    <radialGradient id="dotatm-${id}" cx="50%" cy="50%" r="50%">
      <stop stop-color="${dotGlow}" stop-opacity="0.5"/>
      <stop offset="1" stop-color="${dotGlow}" stop-opacity="0"/>
    </radialGradient>
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

// === THEMES ===
// Dark: "Cyber Atlas" — deep navy ocean, neon green nodes, cyan circuit traces
// Light: "Blueprint" — off-white matte, forest green nodes, dark indigo traces
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
    dotGlow:    '#39d353',
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
    dotGlow:    '#40c463',
  },
};

await mkdir('dist', { recursive: true });
await writeFile('dist/github-contribution-grid-snake-dark.svg', buildSvg(themes.dark));
await writeFile('dist/github-contribution-grid-snake.svg', buildSvg(themes.light));
console.log(`Cyber Atlas: ${active.length} commits → ${shuffledLand.length} land targets, ${borderPaths.length} border traces.`);
