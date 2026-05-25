import { mkdir, writeFile } from 'node:fs/promises';

const USER = process.env.GITHUB_USER || 'advik-bhatt';
const TOKEN = process.env.GITHUB_TOKEN;
const MOCK = process.env.SNAKE_USE_MOCK === '1';
if (!TOKEN && !MOCK) throw new Error('GITHUB_TOKEN is required');

const DAY = 86400000;
const cell = 11;
const gap = 4;
const padX = 28;
const padY = 24;
const radius = 18;
const minLen = 3;
const maxLen = 8;
const stepSeconds = 0.055;
const enterSteps = 8;
const cycles = 10;
const tiny = 1.2;

const patternIds = [
  'butterfly',
  'diagonal-weave',
  'checker-quilt',
  'flower-field',
  'diamond-mandala',
  'aurora-waves',
  'stained-glass',
  'starburst',
  'concentric-bloom',
  'serpentine-lattice',
];

const levels = ['FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];
const weight = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

const themes = {
  light: {
    bg: '#ffffff',
    frame: '#d0d7de',
    grid: '#ebedf0',
    stroke: '#d8dee4',
    snake: '#7c3aed',
    snake2: '#a78bfa',
    commits: {
      NONE: '#ebedf0',
      FIRST_QUARTILE: '#9be9a8',
      SECOND_QUARTILE: '#40c463',
      THIRD_QUARTILE: '#30a14e',
      FOURTH_QUARTILE: '#216e39',
    },
  },
  dark: {
    bg: '#0d1117',
    frame: '#30363d',
    grid: '#161b22',
    stroke: '#21262d',
    snake: '#a855f7',
    snake2: '#c084fc',
    commits: {
      NONE: '#161b22',
      FIRST_QUARTILE: '#0e4429',
      SECOND_QUARTILE: '#006d32',
      THIRD_QUARTILE: '#26a641',
      FOURTH_QUARTILE: '#39d353',
    },
  },
};

const palettes = {
  butterfly: ['#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8'],
  'diagonal-weave': ['#ede9fe', '#c4b5fd', '#8b5cf6', '#6d28d9'],
  'checker-quilt': ['#fce7f3', '#f9a8d4', '#ec4899', '#be185d'],
  'flower-field': ['#ecfccb', '#bef264', '#84cc16', '#4d7c0f'],
  'diamond-mandala': ['#fee2e2', '#fca5a5', '#ef4444', '#991b1b'],
  'aurora-waves': ['#ccfbf1', '#5eead4', '#14b8a6', '#115e59'],
  'stained-glass': ['#fef3c7', '#fcd34d', '#f59e0b', '#92400e'],
  starburst: ['#fae8ff', '#e879f9', '#c026d3', '#86198f'],
  'concentric-bloom': ['#e0f2fe', '#7dd3fc', '#0ea5e9', '#075985'],
  'serpentine-lattice': ['#f3e8ff', '#d8b4fe', '#a855f7', '#6b21a8'],
};

const query = `
  query ContributionCalendar($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks {
            contributionDays {
              contributionCount
              contributionLevel
              date
              weekday
            }
          }
        }
      }
    }
  }
`;

function mockWeeks() {
  return Array.from({ length: 53 }, (_, col) => ({
    contributionDays: Array.from({ length: 7 }, (_, row) => {
      const active = (col + row) % 5 === 0 || (col * row) % 17 === 3 || (col > 36 && row % 2 === 0);
      const contributionLevel = active ? levels[(col + row * 2) % 4] : 'NONE';
      return {
        contributionCount: active ? weight[contributionLevel] : 0,
        contributionLevel,
        date: `mock-${col}-${row}`,
        weekday: row,
      };
    }),
  }));
}

async function loadWeeks() {
  if (MOCK) return mockWeeks();

  const now = new Date();
  const from = new Date(now.getTime() - 370 * DAY);
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: {
        login: USER,
        from: from.toISOString(),
        to: now.toISOString(),
      },
    }),
  });

  if (!response.ok) throw new Error(`GitHub GraphQL request failed: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(`GitHub GraphQL returned errors: ${JSON.stringify(payload.errors)}`);
  return payload.data.user.contributionsCollection.contributionCalendar.weeks;
}

const weeks = await loadWeeks();
const rows = 7;
const cols = weeks.length;
const cells = weeks.flatMap((week, col) =>
  week.contributionDays.map((day) => ({
    col,
    row: day.weekday,
    date: day.date,
    contributionCount: day.contributionCount,
    contributionLevel: day.contributionLevel,
    active: day.contributionCount > 0,
  })),
);

const cellsByKey = new Map(cells.map((c) => [key(c.col, c.row), c]));
const originalCommits = cells.filter((c) => c.active).map((c) => key(c.col, c.row));
const originalSet = new Set(originalCommits);
const width = padX * 2 + cols * (cell + gap) - gap;
const height = padY * 2 + rows * (cell + gap) - gap;

function key(col, row) {
  return `${col},${row}`;
}
function parse(k) {
  const [col, row] = k.split(',').map(Number);
  return { col, row };
}
function x(col) {
  return padX + col * (cell + gap);
}
function y(row) {
  return padY + row * (cell + gap);
}
function center(k) {
  const p = parse(k);
  return { x: x(p.col) + cell / 2, y: y(p.row) + cell / 2 };
}
function inside(col, row) {
  return col >= 0 && col < cols && row >= 0 && row < rows;
}
function distance(a, b) {
  const A = parse(a);
  const B = parse(b);
  return Math.abs(A.col - B.col) + Math.abs(A.row - B.row);
}
function levelFor(w) {
  return levels[Math.max(0, Math.min(3, w - 1))];
}
function addPatternCell(map, col, row, w) {
  if (!inside(col, row)) return;
  const k = key(col, row);
  map.set(k, { key: k, col, row, weight: w, contributionLevel: levelFor(w) });
}

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(list, random) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}
function createScheduler() {
  const random = rng(cells.reduce((sum, c) => sum + c.contributionCount * (c.col + 3) * (c.row + 5), 17) + cols * 97);
  let pool = shuffle(patternIds, random);
  return () => {
    if (pool.length === 0) pool = shuffle(patternIds, random);
    return pool.splice(Math.floor(random() * pool.length), 1)[0];
  };
}

function buildPattern(id) {
  const map = new Map();
  const centerCol = Math.floor(cols / 2);
  const centerRow = 3;

  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      let w = 0;

      if (id === 'butterfly') {
        const left = centerCol - 1;
        const wing = Math.min(Math.abs(col - (left - 7)), Math.abs(col - (left + 8))) + Math.abs(row - 3);
        if ((col === left || col === left + 1) && row > 0 && row < 6) w = row === 3 ? 4 : 3;
        else if (wing <= 7 && Math.abs(row - 3) <= 3) w = wing <= 2 ? 4 : wing <= 4 ? 3 : wing <= 5 ? 2 : 1;
      }

      if (id === 'diagonal-weave' && ((col + row) % 7 === 1 || (col - row + 1000) % 9 === 3)) w = ((col + row) % 4) + 1;

      if (id === 'checker-quilt' && col > 1 && col < cols - 2 && (Math.floor(col / 4) + Math.floor(row / 2)) % 2 === 0 && (col + row) % 2 === 0) w = ((col + row) % 4) + 1;

      if (id === 'flower-field') {
        for (const [flowerCol, flowerRow] of [[Math.floor(cols * 0.22), 2], [Math.floor(cols * 0.5), 4], [Math.floor(cols * 0.78), 2]]) {
          const d = Math.abs(col - flowerCol) + Math.abs(row - flowerRow);
          if (d === 0) w = Math.max(w, 4);
          else if (d === 1) w = Math.max(w, 3);
          else if (d === 2 && (col === flowerCol || row === flowerRow)) w = Math.max(w, 1);
          else if (d === 2) w = Math.max(w, 2);
        }
      }

      if (id === 'diamond-mandala') {
        const d = Math.abs(col - centerCol) + Math.abs(row - centerRow);
        if (d === 4) w = 4;
        else if (d === 8) w = 2;
        else if (d === 12) w = 1;
        if (Math.abs(col - centerCol) === Math.abs(row - centerRow) && Math.abs(col - centerCol) <= 3) w = Math.max(w, 3);
      }

      if (id === 'aurora-waves') {
        const waveA = 1.2 + Math.sin(col * 0.34) * 1.4;
        const waveB = 4.8 + Math.cos(col * 0.27 + 0.8) * 1.1;
        const d = Math.min(Math.abs(row - waveA), Math.abs(row - waveB));
        if (d < 0.45) w = d < 0.2 ? 4 : d < 0.3 ? 3 : 2;
      }

      if (id === 'stained-glass' && (col % 6 === 0 || row === 2 || row === 4 || (col + row) % 11 === 0 || (col - row + 500) % 11 === 0)) w = ((col * 3 + row) % 4) + 1;

      if (id === 'starburst') {
        const d = Math.abs(col - centerCol) + Math.abs(row - centerRow);
        if ((row === centerRow || col === centerCol || Math.abs(col - centerCol) === Math.abs(row - centerRow)) && d > 0 && d <= 10) w = d <= 2 ? 4 : d <= 4 ? 3 : d <= 7 ? 2 : 1;
        if (col === centerCol && row === centerRow) w = 4;
      }

      if (id === 'concentric-bloom') {
        for (const [flowerCol, flowerRow] of [[Math.floor(cols * 0.32), 3], [Math.floor(cols * 0.68), 3]]) {
          const d = Math.abs(col - flowerCol) + Math.abs(row - flowerRow);
          if (d <= 1) w = Math.max(w, 4);
          else if (d <= 3 && (col + row) % 2 === 0) w = Math.max(w, 3);
          else if (d <= 5 && (col + row) % 2 === 1) w = Math.max(w, 2);
          else if (d === 6) w = Math.max(w, 1);
        }
      }

      if (id === 'serpentine-lattice') {
        const rowA = col % 6 <= 2 ? 1 : 5;
        const rowB = col % 8 <= 3 ? 2 : 4;
        if (row === rowA || row === rowB) w = ((col + row) % 4) + 1;
        if (row === 3 && col % 5 === 0) w = 4;
      }

      if (w) addPatternCell(map, col, row, w);
    }
  }

  return map;
}

function rowPath(row, leftToRight) {
  const path = [];
  if (leftToRight) for (let col = 0; col < cols; col += 1) path.push(key(col, row));
  else for (let col = cols - 1; col >= 0; col -= 1) path.push(key(col, row));
  return path;
}
function buildSafeRoute(requiredSteps) {
  const initial = [];
  for (let row = 0; row < rows; row += 1) initial.push(...rowPath(row, row % 2 === 0));

  const upperReturn = [];
  for (let row = rows - 2; row >= 0; row -= 1) upperReturn.push(...rowPath(row, (rows - 2 - row) % 2 === 1));

  const lowerSweep = [];
  for (let row = 1; row < rows; row += 1) lowerSweep.push(...rowPath(row, row % 2 === 0));

  const route = [...initial];
  while (route.length <= requiredSteps + 2) route.push(...upperReturn, ...lowerSweep);

  for (let index = 1; index < route.length; index += 1) {
    if (distance(route[index - 1], route[index]) !== 1) throw new Error(`Bad safe route ${route[index - 1]} to ${route[index]}`);
  }

  return route;
}

function phaseComplete(phase, board) {
  if (phase === 'eat_commits') return board.commits.size === 0;
  if (phase === 'place_pattern') return board.patternTargets.size > 0 && board.patternPresent.size === board.patternTargets.size;
  if (phase === 'eat_pattern') return board.patternTargets.size > 0 && board.patternPresent.size === 0;
  return board.commits.size === originalCommits.length;
}
function eventAt(k, phase, board) {
  if (phase === 'eat_commits' && board.commits.has(k)) return 'eat_commit';
  if (phase === 'place_pattern' && board.patternTargets.has(k) && !board.patternPresent.has(k)) return 'place_pattern';
  if (phase === 'eat_pattern' && board.patternPresent.has(k)) return 'eat_pattern';
  if (phase === 'place_commits' && originalSet.has(k) && !board.commits.has(k)) return 'place_commit';
  return null;
}
function tailVacates(snake, eventType) {
  return snake.grow === 0 && eventType !== 'eat_commit' && eventType !== 'eat_pattern';
}
function blockedCells(body, allowTail) {
  return new Set(body.slice(0, allowTail ? -1 : body.length));
}
function cellWeight(k, board) {
  if (board.patternTargets.has(k)) return board.patternTargets.get(k).weight;
  return weight[cellsByKey.get(k)?.contributionLevel] || 0;
}
function applyMove(next, snake, board, phase, step, events) {
  if (distance(snake.head, next) !== 1) throw new Error(`Illegal non-orthogonal move from ${snake.head} to ${next}`);

  const eventType = eventAt(next, phase, board);
  const occupied = blockedCells(snake.body, tailVacates(snake, eventType));
  occupied.delete(snake.head);
  if (occupied.has(next)) throw new Error(`Illegal self-crossing move into ${next}`);

  snake.head = next;
  snake.body.unshift(next);

  if (eventType) {
    const w = cellWeight(next, board);
    events.push({ step, type: eventType, key: next, weight: w, patternId: board.patternId });

    if (eventType === 'eat_commit') {
      board.commits.delete(next);
      snake.grow += w;
    } else if (eventType === 'place_pattern') {
      board.patternPresent.add(next);
      snake.shrink += w;
    } else if (eventType === 'eat_pattern') {
      board.patternPresent.delete(next);
      snake.grow += w;
    } else if (eventType === 'place_commit') {
      board.commits.add(next);
      snake.shrink += w;
    }
  }

  if (snake.grow > 0 && snake.body.length < maxLen) snake.grow -= 1;
  else snake.body.pop();

  if (snake.shrink > 0 && snake.body.length > minLen) {
    snake.body.pop();
    snake.shrink -= 1;
  }

  while (snake.body.length > maxLen) snake.body.pop();
  while (snake.shrink > 0 && snake.body.length <= minLen) snake.shrink -= 1;

  if (new Set(snake.body).size !== snake.body.length) throw new Error(`Snake body overlap after move to ${next}`);
}

function simulate() {
  const nextPattern = createScheduler();
  const board = { commits: new Set(originalCommits), patternTargets: new Map(), patternPresent: new Set(), patternId: null };
  const snake = { head: key(0, 0), body: [key(0, 0), key(-1, 0), key(-2, 0)], grow: 0, shrink: 0 };
  const route = buildSafeRoute(100000);
  let routeIndex = 0;
  let phase = 'eat_commits';
  let completed = 0;
  let step = 0;

  const steps = [];
  const events = [];
  const patternSequence = [];

  for (let offset = enterSteps; offset >= 1; offset -= 1) {
    steps.push({
      step: step++,
      headKey: key(-offset, 0),
      bodyKeys: [key(-offset, 0), key(-offset - 1, 0), key(-offset - 2, 0)],
      phase: 'enter',
      patternId: null,
    });
  }

  const snapshot = () => steps.push({ step: step++, headKey: snake.head, bodyKeys: [...snake.body], phase, patternId: board.patternId });
  snapshot();

  while (completed < cycles && step < 100000) {
    if (phaseComplete(phase, board)) {
      if (phase === 'eat_commits') {
        board.patternId = nextPattern();
        board.patternTargets = buildPattern(board.patternId);
        board.patternPresent = new Set();
        patternSequence.push(board.patternId);
        phase = 'place_pattern';
      } else if (phase === 'place_pattern') {
        phase = 'eat_pattern';
      } else if (phase === 'eat_pattern') {
        phase = 'place_commits';
      } else {
        completed += 1;
        board.patternId = null;
        board.patternTargets = new Map();
        board.patternPresent = new Set();
        phase = 'eat_commits';
      }
      snapshot();
      continue;
    }

    if (route[routeIndex] !== snake.head) throw new Error(`Safe route desynced: expected ${route[routeIndex]}, got ${snake.head}`);
    routeIndex += 1;
    applyMove(route[routeIndex], snake, board, phase, step, events);
    snapshot();
  }

  if (step >= 100000) throw new Error('Simulation exceeded step limit');
  if (patternSequence.length !== cycles || new Set(patternSequence).size !== patternIds.length) throw new Error(`Pattern selection failed: ${patternSequence.join(', ')}`);

  for (const renderedStep of steps) {
    if (new Set(renderedStep.bodyKeys).size !== renderedStep.bodyKeys.length) throw new Error(`Rendered body overlap at ${renderedStep.step}`);
    if (parse(renderedStep.headKey).col >= 0 && renderedStep.bodyKeys.length < minLen) throw new Error(`Snake below minimum at ${renderedStep.step}`);
  }

  const stepByIndex = new Map(steps.map((renderedStep) => [renderedStep.step, renderedStep]));
  for (const event of events) {
    const renderedStep = stepByIndex.get(event.step);
    if (!renderedStep || renderedStep.headKey !== event.key) throw new Error(`Square event without head contact at ${event.key}`);
  }

  return { steps, events, patternSequence };
}

const sim = simulate();
const loopSeconds = sim.steps.length * stepSeconds;
const times = [...sim.steps.map((s) => Math.min(s.step * stepSeconds, loopSeconds)), loopSeconds];
const keyTimes = (arr) => arr.map((t) => Math.max(0, Math.min(1, t / loopSeconds)).toFixed(6)).join(';');

function pos(k) {
  const p = parse(k);
  if (p.col < 0) return { x: padX + p.col * (cell + gap) + cell / 2, y: y(0) + cell / 2 };
  return center(k);
}

function buildTracks() {
  const count = Math.max(...sim.steps.map((s) => s.bodyKeys.length));
  return Array.from({ length: count }, (_, index) => {
    const values = [];
    const opacities = [];
    for (const renderedStep of sim.steps) {
      const k = renderedStep.bodyKeys[index] ?? renderedStep.bodyKeys.at(-1) ?? renderedStep.headKey;
      const p = pos(k);
      values.push(`${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
      opacities.push(index < renderedStep.bodyKeys.length ? '1' : '0');
    }
    values.push(values.at(-1));
    opacities.push(opacities.at(-1));
    return { index, values, opacities };
  });
}

const tracks = buildTracks();

function groupEvents(filter) {
  const groups = new Map();
  for (const event of sim.events.filter(filter)) {
    if (!groups.has(event.key)) groups.set(event.key, []);
    groups.get(event.key).push(event);
  }
  return groups;
}

const commitEvents = groupEvents((event) => event.type === 'eat_commit' || event.type === 'place_commit');
const patternEvents = new Map();
for (const event of sim.events.filter((event) => event.type === 'eat_pattern' || event.type === 'place_pattern')) {
  if (!patternEvents.has(event.patternId)) patternEvents.set(event.patternId, new Map());
  const patternMap = patternEvents.get(event.patternId);
  if (!patternMap.has(event.key)) patternMap.set(event.key, []);
  patternMap.get(event.key).push(event);
}

function squareAnimation(events, fill, xx, yy, initiallyShown = false) {
  const centerX = xx + cell / 2;
  const centerY = yy + cell / 2;
  const tinyX = centerX - tiny / 2;
  const tinyY = centerY - tiny / 2;

  const opacity = [initiallyShown ? '1' : '0'];
  const xs = [initiallyShown ? xx : tinyX];
  const ys = [initiallyShown ? yy : tinyY];
  const widths = [initiallyShown ? cell : tiny];
  const heights = [initiallyShown ? cell : tiny];
  const radii = [initiallyShown ? '2.4' : '0.8'];
  const eventTimes = [0];

  for (const event of events) {
    const t = event.step * stepSeconds;
    if (event.type.startsWith('place')) {
      opacity.push('0', '1');
      xs.push(tinyX, xx);
      ys.push(tinyY, yy);
      widths.push(tiny, cell);
      heights.push(tiny, cell);
      radii.push('0.8', '2.4');
      eventTimes.push(t, Math.min(t + 0.18, loopSeconds));
    } else {
      opacity.push('1', '0');
      xs.push(xx, xx);
      ys.push(yy, yy);
      widths.push(cell, cell);
      heights.push(cell, cell);
      radii.push('2.4', '2.4');
      eventTimes.push(t, Math.min(t + 0.001, loopSeconds));
    }
  }

  for (const values of [opacity, xs, ys, widths, heights, radii]) values.push(values.at(-1));
  eventTimes.push(loopSeconds);

  return `<rect x="${tinyX}" y="${tinyY}" width="${tiny}" height="${tiny}" rx="0.8" fill="${fill}" opacity="0"><animate attributeName="opacity" dur="${loopSeconds}s" repeatCount="indefinite" calcMode="discrete" values="${opacity.join(';')}" keyTimes="${keyTimes(eventTimes)}"/><animate attributeName="x" dur="${loopSeconds}s" repeatCount="indefinite" values="${xs.join(';')}" keyTimes="${keyTimes(eventTimes)}"/><animate attributeName="y" dur="${loopSeconds}s" repeatCount="indefinite" values="${ys.join(';')}" keyTimes="${keyTimes(eventTimes)}"/><animate attributeName="width" dur="${loopSeconds}s" repeatCount="indefinite" values="${widths.join(';')}" keyTimes="${keyTimes(eventTimes)}"/><animate attributeName="height" dur="${loopSeconds}s" repeatCount="indefinite" values="${heights.join(';')}" keyTimes="${keyTimes(eventTimes)}"/><animate attributeName="rx" dur="${loopSeconds}s" repeatCount="indefinite" values="${radii.join(';')}" keyTimes="${keyTimes(eventTimes)}"/></rect>`;
}

function buildSnake(theme) {
  return `<g id="snake">${tracks.map((track) => {
    const scale = Math.max(0.58, 1 - track.index * 0.018);
    const content = track.index === 0
      ? `<g><ellipse cx="0" cy="0" rx="6.9" ry="5.9" fill="${theme.snake}"/><circle cx="2.3" cy="-2.1" r=".9" fill="#fff"/><circle cx="2.3" cy="2.1" r=".9" fill="#fff"/><circle cx="3.1" cy="-2.1" r=".34" fill="#111827"/><circle cx="3.1" cy="2.1" r=".34" fill="#111827"/></g>`
      : `<g opacity="${Math.max(0.55, 0.96 - track.index * 0.012).toFixed(2)}"><ellipse cx="0" cy="0" rx="${(4.9 * scale).toFixed(2)}" ry="${(4.2 * scale).toFixed(2)}" fill="${theme.snake}"/><ellipse cx=".5" cy="0" rx="${(2.5 * scale).toFixed(2)}" ry="${(2 * scale).toFixed(2)}" fill="${theme.snake2}" opacity=".45"/></g>`;

    return `<g opacity="0" transform="translate(${track.values[0]})"><animate attributeName="opacity" dur="${loopSeconds}s" repeatCount="indefinite" calcMode="discrete" values="${track.opacities.join(';')}" keyTimes="${keyTimes(times)}"/><animateTransform attributeName="transform" type="translate" dur="${loopSeconds}s" repeatCount="indefinite" calcMode="discrete" values="${track.values.join(';')}" keyTimes="${keyTimes(times)}"/>${content}</g>`;
  }).join('')}</g>`;
}

function buildSvg(theme) {
  const grid = cells.map((c) => `<rect x="${x(c.col)}" y="${y(c.row)}" width="${cell}" height="${cell}" rx="2.4" fill="${theme.grid}" stroke="${theme.stroke}" stroke-width=".6"/>`).join('');
  const commits = cells.filter((c) => c.active).map((c) => squareAnimation(commitEvents.get(key(c.col, c.row)) ?? [], theme.commits[c.contributionLevel], x(c.col), y(c.row), true)).join('');
  const patterns = patternIds.map((id) => [...buildPattern(id).values()].map((patternCell) => {
    const events = patternEvents.get(id)?.get(patternCell.key) ?? [];
    return events.length ? squareAnimation(events, palettes[id][patternCell.weight - 1], x(patternCell.col), y(patternCell.row), false) : '';
  }).join('')).join('');

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Animated GitHub contribution grid snake"><rect width="${width}" height="${height}" rx="${radius}" fill="${theme.bg}"/><rect x=".75" y=".75" width="${width - 1.5}" height="${height - 1.5}" rx="${radius - 0.75}" stroke="${theme.frame}" stroke-width="1.5"/>${grid}${commits}${patterns}${buildSnake(theme)}</svg>`;
}

await mkdir('dist', { recursive: true });
await writeFile('dist/github-contribution-grid-snake.svg', buildSvg(themes.light));
await writeFile('dist/github-contribution-grid-snake-dark.svg', buildSvg(themes.dark));

console.log(`Generated strict snake animation with ${sim.steps.length} steps and pattern order: ${sim.patternSequence.join(', ')}`);
