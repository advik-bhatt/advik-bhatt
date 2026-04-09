import { mkdir, writeFile } from 'node:fs/promises';

const USER = process.env.GITHUB_USER || 'advik-bhatt';
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
  throw new Error('GITHUB_TOKEN is required');
}

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOP_SECONDS = 26;
const snakeStart = 0.8;
const snakeDuration = 22;
const initialSnakeLength = 7;

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

const now = new Date();
const from = new Date(now.getTime() - 370 * DAY_MS);

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

if (!response.ok) {
  throw new Error(`GitHub GraphQL request failed: ${response.status} ${response.statusText}`);
}

const payload = await response.json();

if (payload.errors?.length) {
  throw new Error(`GitHub GraphQL returned errors: ${JSON.stringify(payload.errors)}`);
}

const weeks = payload.data.user.contributionsCollection.contributionCalendar.weeks;

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

const cols = weeks.length;
const rows = 7;
const cellSize = 11;
const gap = 4;
const padX = 28;
const padY = 24;
const width = padX * 2 + cols * (cellSize + gap) - gap;
const height = padY * 2 + rows * (cellSize + gap) - gap;
const frameRadius = 18;

const allOrder = [];
for (let col = 0; col < cols; col += 1) {
  const rowsForCol = weeks[col].contributionDays.map((day) => day.weekday).sort((a, b) => a - b);
  if (col % 2 === 0) {
    for (const row of rowsForCol) {
      allOrder.push(`${col}-${row}`);
    }
  } else {
    for (const row of [...rowsForCol].reverse()) {
      allOrder.push(`${col}-${row}`);
    }
  }
}

const cellsByKey = new Map(cells.map((cell) => [cellKey(cell), cell]));

const patternEmptyKeys = new Set();
const centerCol = (cols - 1) / 2;
for (const cell of cells) {
  if (cell.active) {
    continue;
  }

  const waveA = 2.8 + 1.7 * Math.sin(cell.col * 0.34);
  const waveB = 3.4 + 1.3 * Math.cos(cell.col * 0.26 + 1.15);
  const band = Math.abs(cell.row - waveA) < 0.38 || Math.abs(cell.row - waveB) < 0.38;
  const diamond = Math.abs(cell.col - centerCol) + Math.abs(cell.row - 3) === 18;
  if (band || diamond) {
    patternEmptyKeys.add(`${cell.col}-${cell.row}`);
  }
}

if (patternEmptyKeys.size < 16) {
  for (const cell of cells) {
    if (!cell.active && (cell.col * 5 + cell.row * 3) % 11 === 0) {
      patternEmptyKeys.add(`${cell.col}-${cell.row}`);
    }
  }
}

const themes = {
  light: {
    background: '#ffffff',
    frame: '#d0d7de',
    grid: '#ebedf0',
    gridStroke: '#d8dee4',
    snakeShadow: '#9fb3c8',
    original: {
      NONE: '#ebedf0',
      FIRST_QUARTILE: '#9be9a8',
      SECOND_QUARTILE: '#40c463',
      THIRD_QUARTILE: '#30a14e',
      FOURTH_QUARTILE: '#216e39',
    },
    highlightPalette: ['#00bcd4', '#4361ee', '#d63384', '#f59f00'],
    emptyPatternPalette: ['#4cc9f0', '#4895ef', '#b5179e', '#f72585'],
    snakeBody: '#7c3aed',
    snakeBodyGlow: '#a78bfa',
  },
  dark: {
    background: '#0d1117',
    frame: '#30363d',
    grid: '#161b22',
    gridStroke: '#21262d',
    snakeShadow: '#0b1f2d',
    original: {
      NONE: '#161b22',
      FIRST_QUARTILE: '#0e4429',
      SECOND_QUARTILE: '#006d32',
      THIRD_QUARTILE: '#26a641',
      FOURTH_QUARTILE: '#39d353',
    },
    highlightPalette: ['#5af2ff', '#7c6dff', '#ff63c3', '#ffd166'],
    emptyPatternPalette: ['#58f0ff', '#70a4ff', '#c650ff', '#ff8fab'],
    snakeBody: '#a855f7',
    snakeBodyGlow: '#c084fc',
  },
};

const contributionGrowth = {
  NONE: 1,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

function cellKey(cell) {
  return `${cell.col}-${cell.row}`;
}

function cellX(col) {
  return padX + col * (cellSize + gap);
}

function cellY(row) {
  return padY + row * (cellSize + gap);
}

function norm(order, total) {
  return total <= 1 ? 0 : order / (total - 1);
}

function formatTimes(times) {
  return times.map((time) => (time / LOOP_SECONDS).toFixed(4)).join(';');
}

const activeOrderKeys = allOrder.filter((key) => cellsByKey.get(key)?.active);
const activeOrderMap = new Map(activeOrderKeys.map((key, index) => [key, index]));
function cellCenter(col, row) {
  return {
    x: cellX(col) + cellSize / 2,
    y: cellY(row) + cellSize / 2,
  };
}

function buildPathMeta(orderKeys) {
  const first = cellsByKey.get(orderKeys[0]);
  const prelude = initialSnakeLength * (cellSize + gap);
  const start = {
    x: cellX(first.col) + cellSize / 2 - prelude,
    y: cellY(first.row) + cellSize / 2,
  };
  const points = [start, cellCenter(first.col, first.row)];
  const targetProgressByKey = new Map();
  let totalLength = Math.abs(points[1].x - points[0].x) + Math.abs(points[1].y - points[0].y);
  targetProgressByKey.set(orderKeys[0], totalLength);

  for (let index = 1; index < orderKeys.length; index += 1) {
    const previous = cellsByKey.get(orderKeys[index - 1]);
    const current = cellsByKey.get(orderKeys[index]);
    const previousPoint = cellCenter(previous.col, previous.row);
    const currentPoint = cellCenter(current.col, current.row);

    if (previousPoint.x !== currentPoint.x) {
      points.push({ x: currentPoint.x, y: previousPoint.y });
      totalLength += Math.abs(currentPoint.x - previousPoint.x);
    }

    if (previousPoint.y !== currentPoint.y) {
      points.push(currentPoint);
      totalLength += Math.abs(currentPoint.y - previousPoint.y);
    } else if (previousPoint.x === currentPoint.x) {
      points.push(currentPoint);
    }

    targetProgressByKey.set(orderKeys[index], totalLength);
  }

  const pathData = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  return { pathData, totalLength, targetProgressByKey, prelude };
}

function buildActiveAnimation(cell, theme) {
  const order = activeOrderMap.get(cellKey(cell));
  const progress = norm(order, activeOrderKeys.length);
  const eatAt = snakeStart + snakeDuration * progress;
  const originalFill = theme.original[cell.contributionLevel];
  return `<animate attributeName="fill" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="${originalFill};${originalFill};${theme.grid};${theme.grid};${originalFill}" keyTimes="${formatTimes([0, eatAt, eatAt + 0.001, LOOP_SECONDS - 0.001, LOOP_SECONDS])}" />`;
}

function buildSnakePhase(orderKeys, growthValues, theme, suffix) {
  const pathMeta = buildPathMeta(orderKeys);
  const bodyLengths = [];
  let growthTotal = 0;
  for (let index = 0; index < growthValues.length; index += 1) {
    growthTotal += growthValues[index];
    bodyLengths.push(pathMeta.prelude + growthTotal * (cellSize + gap));
  }

  const targetTimes = orderKeys.map((key) => {
    const progressLength = pathMeta.targetProgressByKey.get(key);
    return snakeStart + snakeDuration * (progressLength / pathMeta.totalLength);
  });
  const dashValues = targetTimes.map((_, index) => `${((Math.min(bodyLengths[index], pathMeta.totalLength) / pathMeta.totalLength) * 1000).toFixed(2)} 1000`);
  const dashOffsets = orderKeys.map((key) => {
    const progressLength = pathMeta.targetProgressByKey.get(key);
    return (1000 - ((progressLength / pathMeta.totalLength) * 1000)).toFixed(2);
  });
  const dashKeyTimes = formatTimes([0, ...targetTimes, LOOP_SECONDS]);
  const dashSequence = `${dashValues[0]};${dashValues.join(';')};${dashValues[dashValues.length - 1]}`;
  const dashOffsetSequence = `${dashOffsets[0]};${dashOffsets.join(';')};${dashOffsets[dashOffsets.length - 1]}`;
  const opacityTimes = [0, snakeStart, snakeStart + snakeDuration, Math.min(snakeStart + snakeDuration + 0.25, LOOP_SECONDS - 0.01), LOOP_SECONDS];

  return `<g id="snake-${suffix}">
    <path id="${suffix}-path" d="${pathMeta.pathData}" fill="none" stroke="${theme.snakeBodyGlow}" stroke-width="12.5" stroke-linecap="round" stroke-linejoin="round" opacity="0" filter="url(#snake-glow)" pathLength="1000">
      <animate attributeName="opacity" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="0;1;1;0;0" keyTimes="${formatTimes(opacityTimes)}" />
      <animate attributeName="stroke-dasharray" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear" values="${dashSequence}" keyTimes="${dashKeyTimes}" />
      <animate attributeName="stroke-dashoffset" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear" values="${dashOffsetSequence}" keyTimes="${dashKeyTimes}" />
    </path>
    <path d="${pathMeta.pathData}" fill="none" stroke="${theme.snakeBody}" stroke-width="9.6" stroke-linecap="round" stroke-linejoin="round" opacity="0" pathLength="1000">
      <animate attributeName="opacity" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="0;1;1;0;0" keyTimes="${formatTimes(opacityTimes)}" />
      <animate attributeName="stroke-dasharray" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear" values="${dashSequence}" keyTimes="${dashKeyTimes}" />
      <animate attributeName="stroke-dashoffset" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear" values="${dashOffsetSequence}" keyTimes="${dashKeyTimes}" />
    </path>
    <path d="${pathMeta.pathData}" fill="none" stroke="${theme.snakeBodyGlow}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.95" pathLength="1000">
      <animate attributeName="opacity" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="0;0.85;0.85;0;0" keyTimes="${formatTimes(opacityTimes)}" />
      <animate attributeName="stroke-dasharray" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear" values="${dashSequence}" keyTimes="${dashKeyTimes}" />
      <animate attributeName="stroke-dashoffset" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear" values="${dashOffsetSequence}" keyTimes="${dashKeyTimes}" />
    </path>
    ${buildSnakeSegments(theme, suffix, opacityTimes)}
  </g>`;
}

function buildSnakeSegments(theme, suffix, opacityTimes) {
  const motionTimes = formatTimes([0, snakeStart, snakeStart + snakeDuration, LOOP_SECONDS]);
  const segments = [
    { delay: 0, markup: `<g filter="url(#snake-glow)"><ellipse cx="0" cy="0" rx="8.6" ry="7.2" fill="${theme.snakeBodyGlow}" /><ellipse cx="0" cy="0" rx="6.8" ry="5.8" fill="${theme.snakeBody}" /><circle cx="2.3" cy="-2.1" r="0.9" fill="#ffffff" /><circle cx="2.3" cy="2.1" r="0.9" fill="#ffffff" /><circle cx="3.2" cy="-2.1" r="0.36" fill="#111827" /><circle cx="3.2" cy="2.1" r="0.36" fill="#111827" /></g>` },
    { delay: 0.035, markup: `<ellipse cx="0" cy="0" rx="5.9" ry="5.2" fill="${theme.snakeBody}" opacity="0.96" />` },
    { delay: 0.07, markup: `<ellipse cx="0" cy="0" rx="5.5" ry="4.9" fill="${theme.snakeBody}" opacity="0.92" />` },
    { delay: 0.105, markup: `<ellipse cx="0" cy="0" rx="5.1" ry="4.6" fill="${theme.snakeBody}" opacity="0.88" />` },
    { delay: 0.14, markup: `<ellipse cx="0" cy="0" rx="4.7" ry="4.2" fill="${theme.snakeBody}" opacity="0.82" />` },
    { delay: 0.175, markup: `<ellipse cx="0" cy="0" rx="4.2" ry="3.8" fill="${theme.snakeBody}" opacity="0.76" />` },
  ];

  return segments.map(({ delay, markup }, index) => {
    const keyPoints = `0;0;${Math.max(0, 1 - delay).toFixed(4)};${Math.max(0, 1 - delay).toFixed(4)}`;
    return `<g opacity="0">
      <animate attributeName="opacity" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="0;1;1;0;0" keyTimes="${formatTimes(opacityTimes)}" />
      ${markup}
      <animateMotion dur="${LOOP_SECONDS}s" repeatCount="indefinite" rotate="auto" keyTimes="${motionTimes}" keyPoints="${keyPoints}">
        <mpath href="#${suffix}-path" />
      </animateMotion>
    </g>`;
  }).join('');
}

function buildSvg(theme) {
  const traversalGrowthForActive = activeOrderKeys.map(() => 1);
  const rects = cells
    .map((cell) => {
      const x = cellX(cell.col);
      const y = cellY(cell.row);
      const baseFill = cell.active ? theme.original[cell.contributionLevel] : theme.grid;
      const animate = cell.active ? buildActiveAnimation(cell, theme) : '';
      return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2.4" fill="${baseFill}" stroke="${theme.gridStroke}" stroke-width="0.6">${animate}</rect>`;
    })
    .join('');

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Animated GitHub contribution grid">
  <defs>
    <filter id="snake-glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="2.2" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" rx="${frameRadius}" fill="${theme.background}" />
  <rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="${frameRadius - 0.75}" stroke="${theme.frame}" stroke-width="1.5" />
  <rect x="0" y="0" width="0" height="0" opacity="0">
    <animate id="loop" attributeName="opacity" values="0;0" dur="${LOOP_SECONDS}s" repeatCount="indefinite" />
  </rect>
  ${rects}
  ${activeOrderKeys.length ? buildSnakePhase(activeOrderKeys, traversalGrowthForActive, theme, 'eat-commits') : ''}
</svg>`;
}

await mkdir('dist', { recursive: true });
await writeFile('dist/github-contribution-grid-snake.svg', buildSvg(themes.light));
await writeFile('dist/github-contribution-grid-snake-dark.svg', buildSvg(themes.dark));
