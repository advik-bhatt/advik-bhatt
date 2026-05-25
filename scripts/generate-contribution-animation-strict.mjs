import { mkdir, writeFile } from 'node:fs/promises';

const USER = process.env.GITHUB_USER || 'advik-bhatt';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

const q = `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{contributionCount contributionLevel weekday}}}}}}`;
const now = new Date();
const from = new Date(now.getTime() - 370 * 86400000);
const res = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, variables: { login: USER, from: from.toISOString(), to: now.toISOString() } }) });
if (!res.ok) throw new Error(`GitHub GraphQL failed: ${res.status}`);
const json = await res.json();
if (json.errors?.length) throw new Error(JSON.stringify(json.errors));

const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;
const levels = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const cells = weeks.flatMap((w, c) => w.contributionDays.map((d) => ({ c, r: d.weekday, n: d.contributionCount, l: d.contributionLevel })));
const active = cells.filter((x) => x.n > 0);
const cols = weeks.length;
const w = 847, h = 220, pad = 28, tile = 12, cell = 11, gap = 4, top = 116, ground = 176, world = cols * tile;
const cx = (c) => pad + c * (cell + gap);
const cy = (r) => 20 + r * (cell + gap);
const tx = (c) => pad + c * tile;
const ty = (r, v) => ground - tile - Math.max(0, 5 - Math.min(5, r)) * 2 - (v >= 4 ? 34 : v === 3 ? 22 : v === 2 ? 12 : 0);
const R = (x, y, ww, hh, fill, extra = '') => `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" fill="${fill}" shape-rendering="crispEdges" ${extra}/>`;

const palettes = {
  light: { bg:'#f8fafc', frame:'#cbd5e1', grid:'#e2e8f0', stroke:'#cbd5e1', sky:'#dff5ff', text:'#0f172a', muted:'#475569', outline:'#14532d', a:'#dc2626', b:'#7f1d1d', face:'#fbbf24', g:{NONE:'#e2e8f0',FIRST_QUARTILE:'#9be9a8',SECOND_QUARTILE:'#40c463',THIRD_QUARTILE:'#30a14e',FOURTH_QUARTILE:'#216e39'}},
  dark: { bg:'#0d1117', frame:'#30363d', grid:'#161b22', stroke:'#21262d', sky:'#0f172a', text:'#f8fafc', muted:'#94a3b8', outline:'#052e16', a:'#ef4444', b:'#991b1b', face:'#fde68a', g:{NONE:'#161b22',FIRST_QUARTILE:'#0e4429',SECOND_QUARTILE:'#006d32',THIRD_QUARTILE:'#26a641',FOURTH_QUARTILE:'#39d353'}}
};

function grid(t){
  const base = cells.map((x) => R(cx(x.c), cy(x.r), cell, cell, t.grid, `rx="2.4" stroke="${t.stroke}" stroke-width=".6"`)).join('');
  const dots = active.map((x) => `<rect x="${cx(x.c)}" y="${cy(x.r)}" width="${cell}" height="${cell}" rx="2.4" fill="${t.g[x.l]}"><animate attributeName="opacity" values="1;1;0" keyTimes="0;.55;1" dur="5.4s" fill="freeze"/></rect>`).join('');
  return `<g><animate attributeName="opacity" values="1;1;.16" keyTimes="0;.75;1" dur="5.4s" fill="freeze"/>${base}${dots}</g>`;
}
function fly(t){
  return active.map((x,i)=>{const v=levels[x.l]||1, fx=cx(x.c), fy=cy(x.r), dx=tx(x.c)-fx, dy=ty(x.r,v)-fy, d=1.1+(i%23)*.035; return `<rect x="${fx}" y="${fy}" width="${cell}" height="${cell}" rx="2.4" fill="${t.g[x.l]}" stroke="${t.outline}" stroke-width=".6"><animateTransform attributeName="transform" type="translate" from="0 0" to="${dx} ${dy}" begin="${d}s" dur="2.1s" fill="freeze"/><animate attributeName="width" from="${cell}" to="${tile}" begin="${d}s" dur="2.1s" fill="freeze"/><animate attributeName="height" from="${cell}" to="${tile}" begin="${d}s" dur="2.1s" fill="freeze"/><animate attributeName="rx" from="2.4" to="0" begin="${d}s" dur="2.1s" fill="freeze"/><animate attributeName="opacity" values="1;1;0" keyTimes="0;.92;1" begin="${d}s" dur="2.45s" fill="freeze"/></rect>`}).join('');
}
function worldTiles(t,off){
  let s='';
  for(let c=0;c<cols;c++){if(c%17===11||c%29===21)continue;const x=off+tx(c);s+=R(x,ground,tile,tile,t.g.SECOND_QUARTILE,`stroke="${t.outline}" stroke-width="1"`)+R(x,ground+tile,tile,tile,t.g.FIRST_QUARTILE,`stroke="${t.outline}" stroke-width="1"`)}
  for(const x of active){const v=levels[x.l]||1, xx=off+tx(x.c), yy=ty(x.r,v);s+=R(xx,yy,tile,tile,t.g[x.l],`stroke="${t.outline}" stroke-width="1"`);if(v>=3)s+=R(xx+3,yy+3,3,3,'#f59e0b')}
  return s;
}
function runner(t){return `<g transform="translate(${pad+46} ${ground-32})" opacity="0"><animate attributeName="opacity" values="0;0;1" keyTimes="0;.999;1" dur="5.4s" fill="freeze"/><animateTransform attributeName="transform" type="translate" values="${pad+46} ${ground-32};${pad+46} ${ground-50};${pad+46} ${ground-32};${pad+46} ${ground-32}" keyTimes="0;.34;.68;1" begin="5.4s" dur="1.4s" repeatCount="indefinite"/>${R(6,0,12,8,t.a)}${R(10,8,12,8,t.face)}${R(6,16,18,10,t.a)}${R(2,20,6,8,t.b)}${R(24,20,6,8,t.b)}${R(7,26,6,8,t.b)}${R(17,26,6,8,t.b)}${R(17,11,3,3,'#111827')}</g>`}
function game(t){return `<g opacity="0"><animate attributeName="opacity" values="0;0;1" keyTimes="0;.99;1" dur="5.4s" fill="freeze"/>${R(0,top,w,h-top,t.sky)}<text x="${pad}" y="${top+18}" fill="${t.text}" font-family="monospace" font-size="11" font-weight="700">COMMIT QUEST</text><text x="${pad}" y="${top+34}" fill="${t.muted}" font-family="monospace" font-size="8">original 8-bit runner generated from GitHub commits</text><g clip-path="url(#clip)"><g><animateTransform attributeName="transform" type="translate" from="0 0" to="-${world} 0" begin="5.4s" dur="11s" repeatCount="indefinite"/>${worldTiles(t,0)}${worldTiles(t,world)}</g>${runner(t)}</g></g>`}
function svg(t){return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Animated 8-bit platformer generated from GitHub commits"><defs><clipPath id="clip"><rect x="0" y="${top}" width="${w}" height="${h-top}"/></clipPath></defs><rect width="${w}" height="${h}" rx="18" fill="${t.bg}"/><rect x=".75" y=".75" width="${w-1.5}" height="${h-1.5}" rx="17.25" stroke="${t.frame}" stroke-width="1.5"/><text x="${pad}" y="14" fill="${t.muted}" font-family="monospace" font-size="8" letter-spacing="1.5">COMMITS LOADING INTO PIXEL TERRAIN</text>${grid(t)}${fly(t)}${game(t)}</svg>`}
await mkdir('dist',{recursive:true});
await writeFile('dist/github-contribution-grid-snake.svg',svg(palettes.light));
await writeFile('dist/github-contribution-grid-snake-dark.svg',svg(palettes.dark));
console.log(`Generated 8-bit contribution platformer with ${active.length} commit tiles.`);
