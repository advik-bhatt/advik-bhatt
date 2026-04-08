import { mkdir, writeFile } from 'node:fs/promises';

const USER = process.env.GITHUB_USER || 'advik-bhatt';
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
  throw new Error('GITHUB_TOKEN is required');
}

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOP_SECONDS = 24;

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

const orderMap = new Map(allOrder.map((key, index) => [key, index]));

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
    snakePalette: ['#1f6feb', '#4cc9f0', '#d63384'],
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
  },
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

function cellCenter(col, row) {
  return {
    x: cellX(col) + cellSize / 2,
    y: cellY(row) + cellSize / 2,
  };
}

function norm(order) {
  return allOrder.length <= 1 ? 0 : order / (allOrder.length - 1);
}

function formatTimes(times) {
  return times.map((time) => (time / LOOP_SECONDS).toFixed(4)).join(';');
}

function buildActiveAnimation(cell, theme) {
  const order = orderMap.get(cellKey(cell));
  const progress = norm(order);
  const eatOriginalAt = 6 * progress;
  const showHighlightAt = 6 + 4 * progress;
  const eatHighlightAt = 10 + 3 * progress;
  const restoreAt = 13 + 1 * progress;
  const originalFill = theme.original[cell.contributionLevel];
  const highlightFill = theme.highlightPalette[(cell.col + cell.row * 2) % theme.highlightPalette.length];
  return `<animate attributeName="fill" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="${originalFill};${theme.grid};${highlightFill};${theme.grid};${originalFill};${originalFill}" keyTimes="${formatTimes([0, eatOriginalAt, showHighlightAt, eatHighlightAt, restoreAt, LOOP_SECONDS])}" />`;
}

function buildEmptyPatternAnimation(cell, theme) {
  const order = orderMap.get(cellKey(cell));
  const progress = norm(order);
  const showAt = 14 + 4 * progress;
  const eatAt = 18 + 3 * progress;
  const patternFill = theme.emptyPatternPalette[(cell.col * 2 + cell.row) % theme.emptyPatternPalette.length];
  return `<animate attributeName="fill" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="${theme.grid};${patternFill};${theme.grid};${theme.grid}" keyTimes="${formatTimes([0, showAt, eatAt, LOOP_SECONDS])}" />`;
}

function buildSnakePath() {
  const points = allOrder.map((key) => {
    const [col, row] = key.split('-').map(Number);
    const point = cellCenter(col, row);
    return `${point.x} ${point.y}`;
  });
  return `M ${points.join(' L ')}`;
}

function buildSnakeGroup(theme, startSeconds, durationSeconds, suffix) {
  const radii = [5.4, 4.5, 3.8, 3.1, 2.5];
  const delays = [0, 0.16, 0.32, 0.48, 0.64];
  return radii
    .map((radius, index) => {
      const delay = delays[index];
      const begin = `${startSeconds + delay}s`;
      const opacityDur = Math.max(0.6, durationSeconds - delay);
      const fill = theme.snakePalette[index % theme.snakePalette.length];
      return `
      <circle id="snake-${suffix}-${index}" cx="-20" cy="-20" r="${radius}" fill="${fill}" opacity="0" filter="url(#snake-glow)">
        <animate attributeName="opacity" begin="loop.begin+${begin}" dur="${opacityDur}s" values="0;1;1;0" keyTimes="0;0.08;0.9;1" fill="freeze" />
        <animateMotion begin="loop.begin+${begin}" dur="${durationSeconds}s" fill="freeze" rotate="auto">
          <mpath href="#snake-path" />
        </animateMotion>
      </circle>`;
    })
    .join('');
}

function buildSvg(theme) {
  const snakePath = buildSnakePath();
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
  <path id="snake-path" d="${snakePath}" fill="none" stroke="none" />
  <rect x="0" y="0" width="0" height="0" opacity="0">
    <animate id="loop" attributeName="opacity" values="0;0" dur="${LOOP_SECONDS}s" repeatCount="indefinite" />
  </rect>
  ${rects}
  <path d="${snakePath}" fill="none" stroke="${theme.snakeShadow}" stroke-width="1" stroke-dasharray="1 10" opacity="0.22" />
  ${buildSnakeGroup(theme, 0, 6, 'eat-commits')}
  ${buildSnakeGroup(theme, 10, 3, 'eat-highlights')}
  ${buildSnakeGroup(theme, 18, 3, 'eat-empty-pattern')}
</svg>`;
}

await mkdir('dist', { recursive: true });
await writeFile('dist/github-contribution-grid-snake.svg', buildSvg(themes.light));
await writeFile('dist/github-contribution-grid-snake-dark.svg', buildSvg(themes.dark));
