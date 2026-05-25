import { mkdir, writeFile } from 'node:fs/promises';

const USER = process.env.GITHUB_USER || 'advik-bhatt';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

const DAY = 86400000;
const DOT = 11;
const STEP = 15;
const PAD_X = 28;
const GRID_Y = 28;
const WIDTH = 847;
const HEIGHT = 360;
const LOOP = 34;
const HOLD = 6.5;
const GAME_START = 11.2;
const SCREEN = { x: 14, y: 14, w: 819, h: 332 };
const GROUND_Y = 314;
const WORLD_W = 900;

const query = `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{contributionCount contributionLevel date weekday}}}}}}`;
const now = new Date();
const from = new Date(now.getTime() - 370 * DAY);
const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, variables: { login: USER, from: from.toISOString(), to: now.toISOString() } }),
});
if (!res.ok) throw new Error(`GitHub GraphQL failed: ${res.status}`);
const payload = await res.json();
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
    outer: '#f8fafc', frame: '#cbd5e1', skyTop: '#e0f7ff', skyBottom: '#bae6fd', scan: '#000', scanOpacity: '.035',
    empty: '#ebedf0', emptyStroke: '#d8dee4', text: '#92400e', hud: '#f8fafc', hudOpacity: '.84',
    skyline: '#dbeafe', skyline2: '#bfdbfe', runner: '#dc2626', runner2: '#7f1d1d', skin: '#fbbf24', enemy: '#7c3aed', enemy2: '#4c1d95', coin: '#f59e0b',
    levels: { NONE: '#ebedf0', FIRST_QUARTILE: '#9be9a8', SECOND_QUARTILE: '#40c463', THIRD_QUARTILE: '#30a14e', FOURTH_QUARTILE: '#216e39' },
  },
  dark: {
    outer: '#070b12', frame: '#30363d', skyTop: '#0b1220', skyBottom: '#13243a', scan: '#fff', scanOpacity: '.045',
    empty: '#161b22', emptyStroke: '#21262d', text: '#facc15', hud: '#070b12', hudOpacity: '.84',
    skyline: '#111827', skyline2: '#1f2937', runner: '#ef4444', runner2: '#991b1b', skin: '#fde68a', enemy: '#8b5cf6', enemy2: '#4c1d95', coin: '#facc15',
    levels: { NONE: '#161b22', FIRST_QUARTILE: '#0e4429', SECOND_QUARTILE: '#006d32', THIRD_QUARTILE: '#26a641', FOURTH_QUARTILE: '#39d353' },
  },
};

const levelValue = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const graphX = (col) => PAD_X + col * STEP;
const graphY = (row) => GRID_Y + row * STEP;
const sq = (x, y, color, extra = '') => `<rect x="${x}" y="${y}" width="${DOT}" height="${DOT}" rx="2.4" fill="${color}" stroke="${color}" stroke-width=".6" shape-rendering="geometricPrecision" ${extra}/>`;
const useSq = (x, y, color) => `<use href="#sq" x="${x}" y="${y}" color="${color}"/>`;
const fixed = (n) => Number(n).toFixed(4).replace(/0+$/,'').replace(/\.$/,'');
const kt = (...seconds) => seconds.map((s) => fixed(s / LOOP)).join(';');

function terrainTargets() {
  if (active.length === 0) return [];
  return active.map((cell, index) => {
    const lane = (index * 7 + cell.row * 3 + cell.col) % 58;
    const x = 18 + lane * STEP;
    const tier = (index + cell.row + levelValue[cell.level]) % 9;
    const lift = tier === 0 ? 60 : tier === 1 ? 45 : tier === 2 ? 30 : tier === 3 ? 15 : 0;
    const y = GROUND_Y - DOT - lift;
    return { cell, x, y };
  });
}
const targets = terrainTargets();

function grid(theme) {
  const all = cells.map((c) => sq(graphX(c.col), graphY(c.row), theme.levels[c.level] || theme.empty)).join('');
  return `<g id="actual-calendar"><animate attributeName="opacity" values="1;1;0;0;1" keyTimes="${kt(0,HOLD,GAME_START,LOOP-2,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>${all}</g>`;
}

function migration(theme) {
  return targets.map(({ cell, x, y }, index) => {
    const fromX = graphX(cell.col);
    const fromY = graphY(cell.row);
    const start = HOLD + (index % 28) * 0.055;
    const end = start + 2.7;
    const hide = Math.min(end + .35, GAME_START);
    return `<rect x="${fromX}" y="${fromY}" width="${DOT}" height="${DOT}" rx="2.4" fill="${theme.levels[cell.level]}" stroke="${theme.levels[cell.level]}" stroke-width=".6" opacity="0" shape-rendering="geometricPrecision"><animate attributeName="opacity" values="0;1;1;0;0" keyTimes="${kt(0,start,end,hide,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="0 0;0 0;${x - fromX} ${y - fromY};${x - fromX} ${y - fromY};0 0" keyTimes="${kt(0,start,end,LOOP-1,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/></rect>`;
  }).join('');
}

function skyline(theme) {
  const cols = [
    [20, 8], [65, 10], [110, 8], [155, 11], [230, 8], [305, 10], [380, 12], [455, 7], [530, 9], [605, 10], [680, 8], [755, 10], [830, 7],
  ];
  return `<g opacity=".62"><animateTransform attributeName="transform" type="translate" from="0 0" to="-255 0" begin="${GAME_START}s" dur="28s" repeatCount="indefinite"/>${cols.map(([x, height], i) => Array.from({ length: height }, (_, j) => useSq(x, 294 - j * STEP, i % 3 === 0 ? theme.skyline2 : theme.skyline)).join('')).join('')}</g>`;
}

function cloud(theme, x, y, duration) {
  return `<g opacity=".55"><animateTransform attributeName="transform" type="translate" from="${x} ${y}" to="${x - 900} ${y}" begin="${GAME_START}s" dur="${duration}s" repeatCount="indefinite"/>${useSq(0,15,theme.hud)}${useSq(15,15,theme.hud)}${useSq(30,15,theme.hud)}${useSq(15,0,theme.hud)}${useSq(30,0,theme.hud)}${useSq(45,15,theme.hud)}</g>`;
}

function level(theme) {
  const base = targets.slice(0, 120).map(({ x, y, cell }) => useSq(x, y, theme.levels[cell.level])).join('');
  const platforms = [105,120,135,150,270,285,300,435,450,465,600,615,630].map((x,i)=>useSq(x, i<4?216:i<7?201:i<10?231:201, [theme.levels.SECOND_QUARTILE, theme.levels.THIRD_QUARTILE, theme.levels.FOURTH_QUARTILE][i%3])).join('');
  const coins = [[120,186],[135,171],[150,156],[300,171],[315,156],[330,141],[615,171],[630,156],[645,141],[750,186],[765,171]].map(([x,y])=>`<use href="#coin" x="${x}" y="${y}"/>`).join('');
  const enemies = `<g transform="translate(365 261)"><animateTransform attributeName="transform" type="translate" values="365 261;395 261;365 261" dur="2.6s" repeatCount="indefinite"/><use href="#enemy"/></g><g transform="translate(700 216)"><animateTransform attributeName="transform" type="translate" values="700 216;670 216;700 216" dur="2.9s" repeatCount="indefinite"/><use href="#enemy"/></g>`;
  return `<g id="level">${base}${platforms}${coins}${enemies}</g>`;
}

function runner(theme) {
  return `<g id="runner-shape">${useSq(15,0,theme.runner)}${useSq(15,15,theme.skin)}${useSq(0,30,theme.runner)}${useSq(15,30,theme.runner)}${useSq(30,30,theme.runner)}${useSq(0,45,theme.runner2)}${useSq(30,45,theme.runner2)}${useSq(15,60,theme.runner2)}${useSq(30,60,theme.runner2)}${useSq(30,15,'#111827')}</g>`;
}

function enemy(theme) {
  return `<g id="enemy">${useSq(0,15,theme.enemy)}${useSq(15,15,theme.enemy)}${useSq(30,15,theme.enemy)}${useSq(0,0,theme.enemy)}${useSq(30,0,theme.enemy)}${useSq(15,30,theme.enemy2)}</g>`;
}

function game(theme) {
  return `<g id="game-layer"><animate attributeName="opacity" values="0;0;1;1;0" keyTimes="${kt(0,GAME_START,GAME_START+.4,LOOP-2,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>${skyline(theme)}${cloud(theme,690,62,26)}${cloud(theme,330,78,34)}<g><animateTransform attributeName="transform" type="translate" from="0 0" to="-${WORLD_W} 0" begin="${GAME_START}s" dur="13s" repeatCount="indefinite"/><use href="#level"/><use href="#level" x="${WORLD_W}"/></g><g transform="translate(92 213)"><animateTransform attributeName="transform" type="translate" values="92 213;92 186;92 213;92 213" keyTimes="0;.34;.68;1" begin="${GAME_START}s" dur="1.28s" repeatCount="indefinite"/><use href="#runner-shape"/></g></g>`;
}

function coinHud(theme) {
  return `<rect x="28" y="24" width="118" height="24" rx="8" fill="${theme.hud}" opacity="${theme.hudOpacity}"/><text x="38" y="40" fill="${theme.text}" font-family="monospace" font-size="11" font-weight="700">COINS 000<animate attributeName="opacity" values="1;1;0;0" keyTimes="${kt(0,GAME_START+3,GAME_START+3.1,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/></text><text x="38" y="40" fill="${theme.text}" font-family="monospace" font-size="11" font-weight="700" opacity="0">COINS 017<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="${kt(0,GAME_START+3.1,GAME_START+3.2,GAME_START+8,GAME_START+8.1)}" dur="${LOOP}s" repeatCount="indefinite"/></text><text x="38" y="40" fill="${theme.text}" font-family="monospace" font-size="11" font-weight="700" opacity="0">COINS 042<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="${kt(0,GAME_START+8.1,GAME_START+8.2,LOOP-2,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/></text>`;
}

function svg(theme) {
  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Animated NYC coin runner made from the latest GitHub contribution calendar"><defs><clipPath id="screen"><rect x="${SCREEN.x}" y="${SCREEN.y}" width="${SCREEN.w}" height="${SCREEN.h}" rx="16"/></clipPath><linearGradient id="sky" x1="0" y1="0" x2="0" y2="${HEIGHT}"><stop stop-color="${theme.skyTop}"/><stop offset="1" stop-color="${theme.skyBottom}"/></linearGradient><pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="${theme.scan}" opacity="${theme.scanOpacity}"/></pattern><g id="sq"><rect width="${DOT}" height="${DOT}" rx="2.4" fill="currentColor" stroke="currentColor" stroke-width=".6" shape-rendering="geometricPrecision"/></g><g id="coin"><use href="#sq" color="${theme.coin}"><animate attributeName="opacity" values="1;.35;1" dur=".7s" repeatCount="indefinite"/></use></g>${runner(theme)}${enemy(theme)}${level(theme)}</defs><rect width="${WIDTH}" height="${HEIGHT}" rx="24" fill="${theme.outer}"/><rect x="1" y="1" width="${WIDTH-2}" height="${HEIGHT-2}" rx="23" stroke="${theme.frame}" stroke-width="2"/><g clip-path="url(#screen)"><rect x="${SCREEN.x}" y="${SCREEN.y}" width="${SCREEN.w}" height="${SCREEN.h}" fill="url(#sky)"/>${grid(theme)}${migration(theme)}${game(theme)}<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="url(#scan)"/>${coinHud(theme)}</g></svg>`;
}

await mkdir('dist', { recursive: true });
await writeFile('dist/github-contribution-grid-snake.svg', svg(palettes.light));
await writeFile('dist/github-contribution-grid-snake-dark.svg', svg(palettes.dark));
console.log(`Generated latest-calendar commit-square NYC runner with ${active.length} active contribution cells.`);
