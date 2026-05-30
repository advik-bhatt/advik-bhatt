import { mkdir, writeFile } from 'node:fs/promises';

const USER = process.env.GITHUB_USER || 'advik-bhatt';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

const WIDTH = 847;
const HEIGHT = 260;
const DOT = 11;
const MAP_DOT = 8;
const STEP = 15;
const PAD_X = 28;
const GRID_Y = 72;
const LOOP = 22;
const HOLD = 4.2;
const FLY_END = 8.8;
const MAP_HOLD = 19.4;
const DAY = 86400000;

const query = `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{contributionCount contributionLevel date weekday}}}}}}`;
const now = new Date();
const from = new Date(now.getTime() - 370 * DAY);
const response = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, variables: { login: USER, from: from.toISOString(), to: now.toISOString() } }),
});
if (!response.ok) throw new Error(`GitHub GraphQL failed: ${response.status}`);
const payload = await response.json();
if (payload.errors?.length) throw new Error(JSON.stringify(payload.errors));

const weeks = payload.data.user.contributionsCollection.contributionCalendar.weeks;
const cells = weeks.flatMap((week, col) => week.contributionDays.map((day) => ({
  col,
  row: day.weekday,
  count: day.contributionCount,
  level: day.contributionLevel,
  date: day.date,
})));
const active = cells.filter((c) => c.count > 0);

const palettes = {
  light: {
    bg: '#f8fafc', frame: '#cbd5e1', gridEmpty: '#ebedf0', gridStroke: '#d8dee4', ocean1: '#eefaff', ocean2: '#dff5ff',
    landBase: '#30a14e', landOpacity: '.22',
    levels: { NONE: '#ebedf0', FIRST_QUARTILE: '#9be9a8', SECOND_QUARTILE: '#40c463', THIRD_QUARTILE: '#30a14e', FOURTH_QUARTILE: '#216e39' },
  },
  dark: {
    bg: '#070b12', frame: '#30363d', gridEmpty: '#161b22', gridStroke: '#21262d', ocean1: '#07111f', ocean2: '#0f1f33',
    landBase: '#26a641', landOpacity: '.26',
    levels: { NONE: '#161b22', FIRST_QUARTILE: '#0e4429', SECOND_QUARTILE: '#006d32', THIRD_QUARTILE: '#26a641', FOURTH_QUARTILE: '#39d353' },
  },
};

const graphX = (col) => PAD_X + col * STEP;
const graphY = (row) => GRID_Y + row * STEP;
const fixed = (n) => Number(n).toFixed(4).replace(/0+$/,'').replace(/\.$/,'');
const kt = (...seconds) => seconds.map((s) => fixed(s / LOOP)).join(';');
const rect = (x, y, w, h, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;

function isLand(lon, lat) {
  const e = (cx, cy, rx, ry) => ((lon - cx) / rx) ** 2 + ((lat - cy) / ry) ** 2 <= 1;
  return (
    e(-110, 48, 52, 27) || e(-96, 31, 36, 20) || e(-145, 61, 18, 10) ||
    (lon > -100 && lon < -72 && lat > 7 && lat < 23 && Math.abs(lat - (0.28 * lon + 42)) < 8) ||
    e(-61, -18, 25, 43) || e(-74, -47, 11, 16) ||
    e(15, 51, 35, 17) || e(21, 6, 33, 42) || e(47, -20, 12, 18) ||
    e(70, 48, 62, 25) || e(105, 35, 52, 28) || e(105, 13, 30, 20) ||
    e(78, 21, 16, 20) || e(138, -25, 24, 15)
  );
}

function buildLandPoints() {
  const points = [];
  for (let lat = 74; lat >= -55; lat -= 7.5) {
    for (let lon = -172; lon <= 178; lon += 9.5) {
      if (!isLand(lon, lat)) continue;
      const x = 72 + ((lon + 180) / 360) * 700;
      const y = 40 + ((78 - lat) / 138) * 170;
      points.push({ x: Math.round(x), y: Math.round(y), lon, lat });
    }
  }
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  return points;
}
const land = buildLandPoints();

function stableHash(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function targetForCell(cell) {
  if (land.length === 0) return { x: graphX(cell.col), y: graphY(cell.row) };
  const seed = `${cell.date}-${cell.col}-${cell.row}`;
  return land[stableHash(seed) % land.length];
}

function grid(theme) {
  const empty = cells.map((c) => rect(graphX(c.col), graphY(c.row), DOT, DOT, theme.gridEmpty, `rx="2.4" stroke="${theme.gridStroke}" stroke-width=".6" shape-rendering="geometricPrecision"`)).join('');
  return `<g><animate attributeName="opacity" values="1;1;.13;.13;1" keyTimes="${kt(0,HOLD,FLY_END,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>${empty}</g>`;
}

function worldMapScaffold(theme) {
  const scaffold = land.map((point) => rect(point.x, point.y, MAP_DOT, MAP_DOT, theme.landBase, `rx="1.8" opacity="${theme.landOpacity}" shape-rendering="geometricPrecision"`)).join('');
  return `<g><animate attributeName="opacity" values="0;0;1;1;0" keyTimes="${kt(0,HOLD,FLY_END,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>${scaffold}</g>`;
}

function movingCommits(theme) {
  return active.map((cell, i) => {
    const target = targetForCell(cell);
    const sx = graphX(cell.col);
    const sy = graphY(cell.row);
    const delay = HOLD + (i % 38) * 0.045;
    const arrive = Math.min(delay + 2.6, FLY_END);
    const color = theme.levels[cell.level] || theme.levels.SECOND_QUARTILE;
    return `<rect x="${sx}" y="${sy}" width="${DOT}" height="${DOT}" rx="2.4" fill="${color}" stroke="${color}" stroke-width=".6" shape-rendering="geometricPrecision"><animateTransform attributeName="transform" type="translate" values="0 0;0 0;${target.x - sx} ${target.y - sy};${target.x - sx} ${target.y - sy};0 0" keyTimes="${kt(0,delay,arrive,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/><animate attributeName="width" values="${DOT};${DOT};${MAP_DOT};${MAP_DOT};${DOT}" keyTimes="${kt(0,delay,arrive,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/><animate attributeName="height" values="${DOT};${DOT};${MAP_DOT};${MAP_DOT};${DOT}" keyTimes="${kt(0,delay,arrive,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/><animate attributeName="rx" values="2.4;2.4;1.8;1.8;2.4" keyTimes="${kt(0,delay,arrive,MAP_HOLD,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/></rect>`;
  }).join('');
}

function svg(theme) {
  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub contribution calendar animating into a stable world map"><defs><linearGradient id="ocean" x1="0" y1="0" x2="0" y2="${HEIGHT}"><stop stop-color="${theme.ocean1}"/><stop offset="1" stop-color="${theme.ocean2}"/></linearGradient></defs><rect width="${WIDTH}" height="${HEIGHT}" rx="24" fill="${theme.bg}"/><rect x="1" y="1" width="${WIDTH - 2}" height="${HEIGHT - 2}" rx="23" stroke="${theme.frame}" stroke-width="2"/><rect x="14" y="14" width="${WIDTH - 28}" height="${HEIGHT - 28}" rx="16" fill="url(#ocean)"/>${grid(theme)}${worldMapScaffold(theme)}${movingCommits(theme)}</svg>`;
}

await mkdir('dist', { recursive: true });
await writeFile('dist/github-contribution-grid-snake.svg', svg(palettes.light));
await writeFile('dist/github-contribution-grid-snake-dark.svg', svg(palettes.dark));
console.log(`Generated stable world-map contribution animation from ${active.length} active commits and ${land.length} fixed land targets.`);
