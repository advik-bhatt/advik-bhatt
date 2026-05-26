import { mkdir, writeFile } from 'node:fs/promises';

const USER = process.env.GITHUB_USER || 'advik-bhatt';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

const DAY = 86400000;
const WIDTH = 847;
const HEIGHT = 330;
const DOT = 11;
const STEP = 15;
const PAD_X = 28;
const GRID_Y = 30;
const LOOP = 34;
const HOLD = 6.2;
const REMAP_END = 10.4;
const GAME_START = 11.1;
const WORLD_W = 1040;
const GROUND = 286;

const query = `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{contributionCount contributionLevel date weekday}}}}}}`;
const now = new Date();
const from = new Date(now.getTime() - 370 * DAY);
const response = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, variables: { login: USER, from: from.toISOString(), to: now.toISOString() } }),
});
if (!response.ok) throw new Error(`GitHub GraphQL failed: ${response.status}`);
const json = await response.json();
if (json.errors?.length) throw new Error(JSON.stringify(json.errors));

const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;
const cells = weeks.flatMap((week, col) => week.contributionDays.map((day) => ({ col, row: day.weekday, count: day.contributionCount, level: day.contributionLevel })));
const active = cells.filter((c) => c.count > 0);

const palettes = {
  light: {
    bg: '#f8fafc', frame: '#cbd5e1', sky1: '#e0f7ff', sky2: '#bfe8ff', scan: '#000', scanOpacity: '.025',
    empty: '#ebedf0', hud: '#f8fafc', hudText: '#a16207', city: '#c7d2fe', city2: '#a5b4fc', window: '#fbbf24',
    road: '#111827', road2: '#374151', runner: '#dc2626', runner2: '#7f1d1d', skin: '#fbbf24', enemy: '#7c3aed', coin: '#f59e0b',
    levels: { NONE: '#ebedf0', FIRST_QUARTILE: '#9be9a8', SECOND_QUARTILE: '#40c463', THIRD_QUARTILE: '#30a14e', FOURTH_QUARTILE: '#216e39' },
  },
  dark: {
    bg: '#070b12', frame: '#30363d', sky1: '#050a12', sky2: '#0f1f33', scan: '#fff', scanOpacity: '.04',
    empty: '#161b22', hud: '#070b12', hudText: '#facc15', city: '#111827', city2: '#1f2937', window: '#facc15',
    road: '#030712', road2: '#1f2937', runner: '#ef4444', runner2: '#991b1b', skin: '#fde68a', enemy: '#8b5cf6', coin: '#facc15',
    levels: { NONE: '#161b22', FIRST_QUARTILE: '#0e4429', SECOND_QUARTILE: '#006d32', THIRD_QUARTILE: '#26a641', FOURTH_QUARTILE: '#39d353' },
  },
};

const levelValue = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const graphX = (c) => PAD_X + c * STEP;
const graphY = (r) => GRID_Y + r * STEP;
const kt = (...s) => s.map((x) => (x / LOOP).toFixed(4).replace(/0+$/,'').replace(/\.$/,'')).join(';');
const rect = (x,y,w,h,fill,extra='') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;

function coinTargets() {
  const lanes = [168, 154, 140, 196, 182, 126, 210, 238];
  return active.map((cell, i) => {
    const offscreen = i % 5 === 0;
    const x = offscreen ? WIDTH + 70 + (i % 31) * 38 : 78 + ((i * 53 + cell.row * 41) % 690);
    const y = lanes[(i + cell.row) % lanes.length];
    return { cell, x, y };
  });
}
const coins = coinTargets();

function actualCalendar(theme) {
  return `<g id="actual-calendar"><animate attributeName="opacity" values="1;1;0;0;1" keyTimes="${kt(0,HOLD,REMAP_END,LOOP-2,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>${cells.map((c)=>rect(graphX(c.col), graphY(c.row), DOT, DOT, theme.levels[c.level] || theme.empty, 'rx="2.4" shape-rendering="geometricPrecision"')).join('')}</g>`;
}

function remapToCoins(theme) {
  return coins.map(({ cell, x, y }, i) => {
    const sx = graphX(cell.col), sy = graphY(cell.row);
    const start = HOLD + (i % 34) * 0.045;
    const land = start + 2.5;
    const shrink = Math.min(land + .55, GAME_START - .2);
    return `<rect x="${sx}" y="${sy}" width="${DOT}" height="${DOT}" rx="2.4" fill="${theme.levels[cell.level]}" opacity="0" shape-rendering="crispEdges"><animate attributeName="opacity" values="0;1;1;1;0;0" keyTimes="${kt(0,start,land,shrink,GAME_START,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="0 0;0 0;${x-sx} ${y-sy};${x-sx} ${y-sy};${x-sx} ${y-sy};0 0" keyTimes="${kt(0,start,land,shrink,LOOP-1,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/><animate attributeName="width" values="${DOT};${DOT};${DOT};7;7;${DOT}" keyTimes="${kt(0,start,land,shrink,LOOP-1,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/><animate attributeName="height" values="${DOT};${DOT};${DOT};9;9;${DOT}" keyTimes="${kt(0,start,land,shrink,LOOP-1,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/><animate attributeName="rx" values="2.4;2.4;2.4;1;1;2.4" keyTimes="${kt(0,start,land,shrink,LOOP-1,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/></rect>`;
  }).join('');
}

function skyline(theme) {
  const buildings = [[18,120,46],[84,88,52],[156,142,42],[222,104,60],[310,156,48],[386,112,74],[488,138,58],[570,96,70],[672,150,46],[742,110,62],[826,132,42]];
  return `<g opacity=".78"><animateTransform attributeName="transform" type="translate" from="0 0" to="-260 0" begin="${GAME_START}s" dur="28s" repeatCount="indefinite"/>${buildings.map(([x,h,w],bi)=>{let s=rect(x,GROUND-h,w,h,bi%2?theme.city2:theme.city,'shape-rendering="crispEdges"');for(let wx=x+8;wx<x+w-8;wx+=14){for(let wy=GROUND-h+12;wy<GROUND-14;wy+=18){if((wx+wy+bi)%3!==0)s+=rect(wx,wy,5,7,theme.window,'shape-rendering="crispEdges"')}}return s}).join('')}</g>`;
}

function level(theme) {
  let s = '';
  for(let x=0;x<WORLD_W;x+=28){ if(x%196<34) continue; s += rect(x,GROUND,28,18,theme.road,'shape-rendering="crispEdges"') + rect(x,GROUND+18,28,10,theme.road2,'shape-rendering="crispEdges"'); }
  const platforms = [[125,232,96],[290,208,112],[454,244,82],[620,198,120],[780,232,96]];
  for(const [x,y,w] of platforms) s += rect(x,y,w,14,theme.levels.THIRD_QUARTILE,'shape-rendering="crispEdges"') + rect(x,y+14,w,8,theme.levels.SECOND_QUARTILE,'shape-rendering="crispEdges"');
  for(const {x,y} of coins.slice(0,70)) s += `<use href="#coin" x="${((x%WORLD_W)+WORLD_W)%WORLD_W}" y="${y}"/>`;
  s += `<g transform="translate(370 ${GROUND-22})"><animateTransform attributeName="transform" type="translate" values="370 ${GROUND-22};420 ${GROUND-22};370 ${GROUND-22}" dur="2.5s" repeatCount="indefinite"/><use href="#enemy"/></g>`;
  s += `<g transform="translate(710 218)"><animateTransform attributeName="transform" type="translate" values="710 218;655 218;710 218" dur="2.9s" repeatCount="indefinite"/><use href="#enemy"/></g>`;
  return `<g id="level">${s}</g>`;
}

function spriteDefs(theme) {
  return `<g id="coin"><rect width="7" height="9" rx="1" fill="${theme.coin}" shape-rendering="crispEdges"><animate attributeName="opacity" values="1;.35;1" dur=".7s" repeatCount="indefinite"/></rect></g><g id="enemy" shape-rendering="crispEdges"><rect x="0" y="8" width="34" height="18" fill="${theme.enemy}"/><rect x="6" y="0" width="8" height="8" fill="${theme.enemy}"/><rect x="20" y="0" width="8" height="8" fill="${theme.enemy}"/><rect x="8" y="13" width="5" height="5" fill="#111827"/><rect x="22" y="13" width="5" height="5" fill="#111827"/></g><g id="runner" shape-rendering="crispEdges"><rect x="15" y="0" width="20" height="12" fill="${theme.runner}"/><rect x="12" y="12" width="22" height="14" fill="${theme.skin}"/><rect x="8" y="26" width="32" height="24" fill="${theme.runner}"/><rect x="0" y="34" width="10" height="14" fill="${theme.runner2}"/><rect x="40" y="34" width="10" height="14" fill="${theme.runner2}"/><rect x="10" y="50" width="11" height="18" fill="${theme.runner2}"/><rect x="30" y="50" width="11" height="18" fill="${theme.runner2}"/><rect x="27" y="17" width="5" height="5" fill="#111827"/></g>`;
}

function game(theme) {
  return `<g id="game" opacity="0"><animate attributeName="opacity" values="0;0;1;1;0" keyTimes="${kt(0,GAME_START,GAME_START+.35,LOOP-2,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/>${skyline(theme)}<g><animateTransform attributeName="transform" type="translate" from="0 0" to="-${WORLD_W} 0" begin="${GAME_START}s" dur="14s" repeatCount="indefinite"/><use href="#level"/><use href="#level" x="${WORLD_W}"/></g><g transform="translate(92 226)"><animateTransform attributeName="transform" type="translate" values="92 226;92 190;92 226;92 226" keyTimes="0;.34;.68;1" begin="${GAME_START}s" dur="1.25s" repeatCount="indefinite"/><use href="#runner"/></g></g>`;
}

function hud(theme) {
  return `<rect x="28" y="22" width="104" height="22" rx="7" fill="${theme.hud}" opacity=".84"/><text x="40" y="37" fill="${theme.hudText}" font-family="monospace" font-size="10" font-weight="700">COINS 000<animate attributeName="opacity" values="1;1;0;0" keyTimes="${kt(0,GAME_START+3,GAME_START+3.1,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/></text><text x="40" y="37" fill="${theme.hudText}" font-family="monospace" font-size="10" font-weight="700" opacity="0">COINS 017<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="${kt(0,GAME_START+3.1,GAME_START+3.2,GAME_START+8,GAME_START+8.1)}" dur="${LOOP}s" repeatCount="indefinite"/></text><text x="40" y="37" fill="${theme.hudText}" font-family="monospace" font-size="10" font-weight="700" opacity="0">COINS 042<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="${kt(0,GAME_START+8.1,GAME_START+8.2,LOOP-2,LOOP)}" dur="${LOOP}s" repeatCount="indefinite"/></text>`;
}

function svg(theme){return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub contribution calendar remapped into a clean NYC coin runner"><defs><clipPath id="screen"><rect x="14" y="14" width="819" height="302" rx="16"/></clipPath><linearGradient id="sky" x1="0" y1="0" x2="0" y2="${HEIGHT}"><stop stop-color="${theme.sky1}"/><stop offset="1" stop-color="${theme.sky2}"/></linearGradient><pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="${theme.scan}" opacity="${theme.scanOpacity}"/></pattern>${spriteDefs(theme)}${level(theme)}</defs><rect width="${WIDTH}" height="${HEIGHT}" rx="24" fill="${theme.bg}"/><rect x="1" y="1" width="845" height="328" rx="23" stroke="${theme.frame}" stroke-width="2"/><g clip-path="url(#screen)"><rect x="14" y="14" width="819" height="302" fill="url(#sky)"/>${actualCalendar(theme)}${remapToCoins(theme)}${game(theme)}<rect width="847" height="330" fill="url(#scan)"/>${hud(theme)}</g></svg>`}

await mkdir('dist', { recursive: true });
await writeFile('dist/github-contribution-grid-snake.svg', svg(palettes.light));
await writeFile('dist/github-contribution-grid-snake-dark.svg', svg(palettes.dark));
console.log(`Generated clean coin-runner transition from ${active.length} active contribution cells.`);
