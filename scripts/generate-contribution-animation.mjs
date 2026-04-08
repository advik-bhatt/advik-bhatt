import { mkdir, writeFile } from 'node:fs/promises';

const USER = process.env.GITHUB_USER || 'advik-bhatt';
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
  throw new Error('GITHUB_TOKEN is required');
}

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOP_SECONDS = 20;

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
  if (col % 2 === 0) {
    for (let row = 0; row < rows; row += 1) {
      allOrder.push(`${col}-${row}`);
    }
  } else {
    for (let row = rows - 1; row >= 0; row -= 1) {
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
    snakePalette: ['#1f6feb', '#4cc9f0', '#7c3aed'],
    snakeHead: '#f59f00',
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
    snakePalette: ['#58f0ff', '#7c6dff', '#ff63c3'],
    snakeHead: '#ffd166',
  },
};

const contributionGrowth = {
  NONE: 1,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

const phaseConfig = {
  commitEat: { start: 0, duration: 4.2 },
  highlightShow: { start: 4.8, duration: 2.8 },
  highlightEat: { start: 8.0, duration: 2.2 },
  restoreOriginal: { start: 10.6, duration: 0.5 },
  emptyShow: { start: 11.4, duration: 2.8 },
  emptyEat: { start: 14.6, duration: 2.2 },
};

const initialSnakeLength = 4;

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
const emptyPatternOrderKeys = allOrder.filter((key) => patternEmptyKeys.has(key));
const activeOrderMap = new Map(activeOrderKeys.map((key, index) => [key, index]));
const emptyPatternOrderMap = new Map(emptyPatternOrderKeys.map((key, index) => [key, index]));

function buildActiveAnimation(cell, theme) {
  const order = activeOrderMap.get(cellKey(cell));
  const progress = norm(order, activeOrderKeys.length);
  const eatOriginalAt = phaseConfig.commitEat.start + phaseConfig.commitEat.duration * progress;
  const showHighlightAt = phaseConfig.highlightShow.start + phaseConfig.highlightShow.duration * progress;
  const eatHighlightAt = phaseConfig.highlightEat.start + phaseConfig.highlightEat.duration * progress;
  const restoreAt = phaseConfig.restoreOriginal.start + phaseConfig.restoreOriginal.duration * progress;
  const originalFill = theme.original[cell.contributionLevel];
  const highlightFill = theme.highlightPalette[(cell.col + cell.row * 2) % theme.highlightPalette.length];
  return `<animate attributeName="fill" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="${originalFill};${theme.grid};${highlightFill};${theme.grid};${originalFill};${originalFill}" keyTimes="${formatTimes([0, eatOriginalAt, showHighlightAt, eatHighlightAt, restoreAt, LOOP_SECONDS])}" />`;
}

function buildEmptyPatternAnimation(cell, theme) {
  const order = emptyPatternOrderMap.get(cellKey(cell));
  const progress = norm(order, emptyPatternOrderKeys.length);
  const showAt = phaseConfig.emptyShow.start + phaseConfig.emptyShow.duration * progress;
  const eatAt = phaseConfig.emptyEat.start + phaseConfig.emptyEat.duration * progress;
  const patternFill = theme.emptyPatternPalette[(cell.col * 2 + cell.row) % theme.emptyPatternPalette.length];
  return `<animate attributeName="fill" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="${theme.grid};${patternFill};${theme.grid};${theme.grid}" keyTimes="${formatTimes([0, showAt, eatAt, LOOP_SECONDS])}" />`;
}

function buildOccupancy(orderKeys, growthValues) {
  const prefixGrowth = [];
  let totalGrowth = 0;
  for (let index = 0; index < growthValues.length; index += 1) {
    totalGrowth += growthValues[index];
    prefixGrowth.push(totalGrowth);
  }

  return orderKeys.map((key, index) => {
    let hideIndex = orderKeys.length;
    for (let headIndex = index; headIndex < orderKeys.length; headIndex += 1) {
      const currentLength = initialSnakeLength + prefixGrowth[headIndex];
      if (headIndex >= index + currentLength) {
        hideIndex = headIndex;
        break;
      }
    }
    return { key, index, hideIndex };
  });
}

function buildSnakePhase(orderKeys, growthValues, phase, theme, suffix) {
  const occupancy = buildOccupancy(orderKeys, growthValues);
  const total = orderKeys.length;
  const bodyInset = 0.8;
  const headInset = 0.15;

  const bodyRects = occupancy.map(({ key, index, hideIndex }) => {
    const cell = cellsByKey.get(key);
    const x = cellX(cell.col) + bodyInset;
    const y = cellY(cell.row) + bodyInset;
    const headAt = phase.start + phase.duration * norm(index, total);
    const hideAt = hideIndex >= total
      ? phase.start + phase.duration + 0.06
      : phase.start + phase.duration * norm(hideIndex, total);
    const fill = theme.snakePalette[index % theme.snakePalette.length];
    return `<rect x="${x}" y="${y}" width="${cellSize - bodyInset * 2}" height="${cellSize - bodyInset * 2}" rx="1.8" fill="${fill}" opacity="0" filter="url(#snake-glow)"><animate attributeName="opacity" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="0;1;1;0;0" keyTimes="${formatTimes([0, headAt, Math.min(hideAt, LOOP_SECONDS - 0.01), Math.min(hideAt + 0.02, LOOP_SECONDS - 0.005), LOOP_SECONDS])}" /></rect>`;
  }).join('');

  const headRects = occupancy.map(({ key, index }) => {
    const cell = cellsByKey.get(key);
    const x = cellX(cell.col) + headInset;
    const y = cellY(cell.row) + headInset;
    const headAt = phase.start + phase.duration * norm(index, total);
    const nextAt = index === total - 1
      ? phase.start + phase.duration
      : phase.start + phase.duration * norm(index + 1, total);
    return `<rect x="${x}" y="${y}" width="${cellSize - headInset * 2}" height="${cellSize - headInset * 2}" rx="2.2" fill="${theme.snakeHead}" opacity="0" filter="url(#snake-glow)"><animate attributeName="opacity" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="0;1;0;0" keyTimes="${formatTimes([0, headAt, Math.min(nextAt, LOOP_SECONDS - 0.01), LOOP_SECONDS])}" /></rect>`;
  }).join('');

  return `<g id="snake-${suffix}">${bodyRects}${headRects}</g>`;
}

function buildSvg(theme) {
  const activeGrowth = activeOrderKeys.map((key) => contributionGrowth[cellsByKey.get(key).contributionLevel] ?? 1);
  const emptyGrowth = emptyPatternOrderKeys.map(() => 1);
  const rects = cells
    .map((cell) => {
      const key = cellKey(cell);
      const x = cellX(cell.col);
      const y = cellY(cell.row);
      const baseFill = cell.active ? theme.original[cell.contributionLevel] : theme.grid;
      const animate = cell.active
        ? buildActiveAnimation(cell, theme)
        : patternEmptyKeys.has(key)
          ? buildEmptyPatternAnimation(cell, theme)
          : '';
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
  ${buildSnakePhase(activeOrderKeys, activeGrowth, phaseConfig.commitEat, theme, 'eat-commits')}
  ${buildSnakePhase(activeOrderKeys, activeGrowth, phaseConfig.highlightEat, theme, 'eat-highlights')}
  ${buildSnakePhase(emptyPatternOrderKeys, emptyGrowth, phaseConfig.emptyEat, theme, 'eat-empty-pattern')}
</svg>`;
}

await mkdir('dist', { recursive: true });
await writeFile('dist/github-contribution-grid-snake.svg', buildSvg(themes.light));
await writeFile('dist/github-contribution-grid-snake-dark.svg', buildSvg(themes.dark));
