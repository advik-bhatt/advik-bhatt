import { mkdir, writeFile } from 'node:fs/promises';

const USER = process.env.GITHUB_USER || 'advik-bhatt';
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
  throw new Error('GITHUB_TOKEN is required');
}

const DAY_MS = 24 * 60 * 60 * 1000;
const cellSize = 11;
const gap = 4;
const padX = 28;
const padY = 24;
const frameRadius = 18;
const initialSnakeLength = 3;
const maxSnakeLength = 120;
const segmentSpacing = 8.5;
const stepSeconds = 0.055;
const enterPaddingSteps = 8;
const totalCycles = 10;
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

const themes = {
  light: {
    background: '#ffffff',
    frame: '#d0d7de',
    grid: '#ebedf0',
    gridStroke: '#d8dee4',
    original: {
      NONE: '#ebedf0',
      FIRST_QUARTILE: '#9be9a8',
      SECOND_QUARTILE: '#40c463',
      THIRD_QUARTILE: '#30a14e',
      FOURTH_QUARTILE: '#216e39',
    },
    patternPalettes: {
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
    },
    snakeBody: '#7c3aed',
    snakeBodyGlow: '#a78bfa',
  },
  dark: {
    background: '#0d1117',
    frame: '#30363d',
    grid: '#161b22',
    gridStroke: '#21262d',
    original: {
      NONE: '#161b22',
      FIRST_QUARTILE: '#0e4429',
      SECOND_QUARTILE: '#006d32',
      THIRD_QUARTILE: '#26a641',
      FOURTH_QUARTILE: '#39d353',
    },
    patternPalettes: {
      butterfly: ['#1e3a8a', '#2563eb', '#60a5fa', '#bfdbfe'],
      'diagonal-weave': ['#2e1065', '#6d28d9', '#a78bfa', '#ddd6fe'],
      'checker-quilt': ['#831843', '#db2777', '#f472b6', '#fbcfe8'],
      'flower-field': ['#365314', '#65a30d', '#a3e635', '#d9f99d'],
      'diamond-mandala': ['#7f1d1d', '#dc2626', '#f87171', '#fecaca'],
      'aurora-waves': ['#134e4a', '#0f766e', '#2dd4bf', '#99f6e4'],
      'stained-glass': ['#78350f', '#d97706', '#fbbf24', '#fde68a'],
      starburst: ['#701a75', '#c026d3', '#e879f9', '#f5d0fe'],
      'concentric-bloom': ['#082f49', '#0284c7', '#38bdf8', '#bae6fd'],
      'serpentine-lattice': ['#581c87', '#9333ea', '#c084fc', '#f3e8ff'],
    },
    snakeBody: '#a855f7',
    snakeBodyGlow: '#c084fc',
  },
};

const contributionGrowth = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

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
const width = padX * 2 + cols * (cellSize + gap) - gap;
const height = padY * 2 + rows * (cellSize + gap) - gap;

const cellsByKey = new Map(cells.map((cell) => [cellKey(cell), cell]));
const allBoardKeys = [];
for (let row = 0; row < rows; row += 1) {
  for (let col = 0; col < cols; col += 1) {
    allBoardKeys.push(`${col}-${row}`);
  }
}
const originalCommitKeys = cells.filter((cell) => cell.active).map(cellKey);

function cellKey(cell) {
  return `${cell.col}-${cell.row}`;
}

function parseKey(key) {
  const [col, row] = key.split('-').map(Number);
  return { col, row };
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

function weightToLevel(weight) {
  return ['FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'][Math.max(0, Math.min(3, weight - 1))];
}

function isInsideBoard(col, row) {
  return col >= 0 && col < cols && row >= 0 && row < rows;
}

function neighbors(key) {
  const { col, row } = parseKey(key);
  return [
    `${col + 1}-${row}`,
    `${col}-${row + 1}`,
    `${col}-${row - 1}`,
    `${col - 1}-${row}`,
  ].filter((candidate) => {
    const next = parseKey(candidate);
    return isInsideBoard(next.col, next.row);
  });
}

function manhattan(aKey, bKey) {
  const a = parseKey(aKey);
  const b = parseKey(bKey);
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function createPatternScheduler() {
  const seed = cells.reduce((sum, cell) => sum + cell.contributionCount * (cell.col + 3) * (cell.row + 5), 17) + cols * 97;
  const random = mulberry32(seed);
  let available = shuffle(patternIds, random);

  return {
    next() {
      if (available.length === 0) {
        available = shuffle(patternIds, random);
      }
      const index = Math.floor(random() * available.length);
      const [chosen] = available.splice(index, 1);
      return chosen;
    },
  };
}

function addPatternCell(map, col, row, weight) {
  if (!isInsideBoard(col, row)) {
    return;
  }
  const key = `${col}-${row}`;
  const cell = cellsByKey.get(key);
  if (!cell) {
    return;
  }
  map.set(key, {
    key,
    col,
    row,
    weight,
    contributionLevel: weightToLevel(weight),
  });
}

function mirroredAdd(map, col, row, weight) {
  addPatternCell(map, col, row, weight);
  addPatternCell(map, cols - 1 - col, row, weight);
}

function buildButterflyPattern() {
  const map = new Map();
  const centerLeft = Math.floor((cols - 1) / 2) - 1;
  const wingOffsets = [
    { dx: -12, rows: [3] },
    { dx: -11, rows: [2, 3, 4] },
    { dx: -10, rows: [2, 3, 4] },
    { dx: -9, rows: [1, 2, 3, 4, 5] },
    { dx: -8, rows: [1, 2, 3, 4, 5] },
    { dx: -7, rows: [1, 2, 3, 4, 5] },
    { dx: -6, rows: [0, 1, 2, 3, 4, 5, 6] },
    { dx: -5, rows: [0, 1, 2, 3, 4, 5, 6] },
    { dx: -4, rows: [1, 2, 3, 4, 5] },
    { dx: -3, rows: [1, 2, 4, 5] },
    { dx: -2, rows: [2, 4] },
  ];

  for (const row of [1, 2, 3, 4, 5]) {
    addPatternCell(map, centerLeft, row, row === 3 ? 4 : row === 2 || row === 4 ? 3 : 2);
    addPatternCell(map, centerLeft + 1, row, row === 3 ? 4 : row === 2 || row === 4 ? 3 : 2);
  }

  for (const { dx, rows: patternRows } of wingOffsets) {
    for (const row of patternRows) {
      const distance = Math.abs(row - 3) + Math.abs(dx);
      const weight = distance <= 4 ? 4 : distance <= 7 ? 3 : distance <= 10 ? 2 : 1;
      mirroredAdd(map, centerLeft + dx, row, weight);
    }
  }

  return map;
}

function buildDiagonalWeavePattern() {
  const map = new Map();
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      if ((col + row) % 7 === 1 || (col - row + 1000) % 9 === 3) {
        const band = (col + row) % 4;
        addPatternCell(map, col, row, band + 1);
      }
    }
  }
  return map;
}

function buildCheckerQuiltPattern() {
  const map = new Map();
  for (let col = 2; col < cols - 2; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      const block = Math.floor(col / 4) + Math.floor(row / 2);
      if (block % 2 === 0 && (col + row) % 2 === 0) {
        addPatternCell(map, col, row, ((col + row) % 4) + 1);
      }
    }
  }
  return map;
}

function buildFlowerFieldPattern() {
  const map = new Map();
  const centers = [
    [Math.floor(cols * 0.22), 2],
    [Math.floor(cols * 0.5), 4],
    [Math.floor(cols * 0.78), 2],
  ];
  for (const [centerCol, centerRow] of centers) {
    addPatternCell(map, centerCol, centerRow, 4);
    for (const [dx, dy, weight] of [[1, 0, 3], [-1, 0, 3], [0, 1, 3], [0, -1, 3], [2, 0, 1], [-2, 0, 1], [0, 2, 1], [0, -2, 1], [1, 1, 2], [1, -1, 2], [-1, 1, 2], [-1, -1, 2]]) {
      addPatternCell(map, centerCol + dx, centerRow + dy, weight);
    }
  }
  return map;
}

function buildDiamondMandalaPattern() {
  const map = new Map();
  const centerCol = Math.floor(cols / 2);
  const centerRow = 3;
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      const distance = Math.abs(col - centerCol) + Math.abs(row - centerRow);
      if (distance === 4 || distance === 8 || distance === 12) {
        addPatternCell(map, col, row, distance === 4 ? 4 : distance === 8 ? 2 : 1);
      }
      if (Math.abs(col - centerCol) === Math.abs(row - centerRow) && Math.abs(col - centerCol) <= 3) {
        addPatternCell(map, col, row, 3);
      }
    }
  }
  return map;
}

function buildAuroraWavesPattern() {
  const map = new Map();
  for (let col = 0; col < cols; col += 1) {
    const waveA = 1.2 + Math.sin(col * 0.34) * 1.4;
    const waveB = 4.8 + Math.cos(col * 0.27 + 0.8) * 1.1;
    for (let row = 0; row < rows; row += 1) {
      const distA = Math.abs(row - waveA);
      const distB = Math.abs(row - waveB);
      if (distA < 0.45 || distB < 0.45) {
        const weight = distA < 0.2 || distB < 0.2 ? 4 : distA < 0.3 || distB < 0.3 ? 3 : 2;
        addPatternCell(map, col, row, weight);
      }
    }
  }
  return map;
}

function buildStainedGlassPattern() {
  const map = new Map();
  for (let col = 1; col < cols - 1; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      const vertical = col % 6 === 0;
      const horizontal = row === 2 || row === 4;
      const diagonal = (col + row) % 11 === 0 || (col - row + 500) % 11 === 0;
      if (vertical || horizontal || diagonal) {
        addPatternCell(map, col, row, ((col * 3 + row) % 4) + 1);
      }
    }
  }
  return map;
}

function buildStarburstPattern() {
  const map = new Map();
  const centerCol = Math.floor(cols / 2);
  const centerRow = 3;
  for (let radius = 1; radius <= 10; radius += 1) {
    const weight = radius <= 2 ? 4 : radius <= 4 ? 3 : radius <= 7 ? 2 : 1;
    addPatternCell(map, centerCol + radius, centerRow, weight);
    addPatternCell(map, centerCol - radius, centerRow, weight);
    if (radius <= 3) {
      addPatternCell(map, centerCol, centerRow + radius, weight);
      addPatternCell(map, centerCol, centerRow - radius, weight);
    }
    addPatternCell(map, centerCol + radius, centerRow + Math.min(3, radius), weight);
    addPatternCell(map, centerCol - radius, centerRow - Math.min(3, radius), weight);
    addPatternCell(map, centerCol + radius, centerRow - Math.min(3, radius), weight);
    addPatternCell(map, centerCol - radius, centerRow + Math.min(3, radius), weight);
  }
  addPatternCell(map, centerCol, centerRow, 4);
  return map;
}

function buildConcentricBloomPattern() {
  const map = new Map();
  const centers = [
    [Math.floor(cols * 0.32), 3],
    [Math.floor(cols * 0.68), 3],
  ];
  for (const [centerCol, centerRow] of centers) {
    for (let col = centerCol - 4; col <= centerCol + 4; col += 1) {
      for (let row = centerRow - 3; row <= centerRow + 3; row += 1) {
        if (!isInsideBoard(col, row)) {
          continue;
        }
        const distance = Math.abs(col - centerCol) + Math.abs(row - centerRow);
        if (distance <= 1) {
          addPatternCell(map, col, row, 4);
        } else if (distance <= 3 && (col + row) % 2 === 0) {
          addPatternCell(map, col, row, 3);
        } else if (distance <= 5 && (col + row) % 2 === 1) {
          addPatternCell(map, col, row, 2);
        } else if (distance === 6) {
          addPatternCell(map, col, row, 1);
        }
      }
    }
  }
  return map;
}

function buildSerpentineLatticePattern() {
  const map = new Map();
  for (let col = 0; col < cols; col += 1) {
    const rowA = (col % 6) <= 2 ? 1 : 5;
    const rowB = (col % 8) <= 3 ? 2 : 4;
    addPatternCell(map, col, rowA, ((col + rowA) % 4) + 1);
    addPatternCell(map, col, rowB, ((col + rowB + 1) % 4) + 1);
    if (col % 5 === 0) {
      addPatternCell(map, col, 3, 4);
    }
  }
  return map;
}

function buildPatternById(patternId) {
  const patterns = {
    butterfly: buildButterflyPattern,
    'diagonal-weave': buildDiagonalWeavePattern,
    'checker-quilt': buildCheckerQuiltPattern,
    'flower-field': buildFlowerFieldPattern,
    'diamond-mandala': buildDiamondMandalaPattern,
    'aurora-waves': buildAuroraWavesPattern,
    'stained-glass': buildStainedGlassPattern,
    starburst: buildStarburstPattern,
    'concentric-bloom': buildConcentricBloomPattern,
    'serpentine-lattice': buildSerpentineLatticePattern,
  };
  return patterns[patternId]();
}

function phaseTargets(phase, boardState) {
  if (phase === 'eat_commits') {
    return [...boardState.commitPresent].sort(sortKeys);
  }
  if (phase === 'place_pattern') {
    return [...boardState.patternTargets.keys()].filter((key) => !boardState.patternPresent.has(key)).sort(sortKeys);
  }
  if (phase === 'eat_pattern') {
    return [...boardState.patternPresent].sort(sortKeys);
  }
  return [...originalCommitKeys].filter((key) => !boardState.commitPresent.has(key)).sort(sortKeys);
}

function sortKeys(leftKey, rightKey) {
  const left = parseKey(leftKey);
  const right = parseKey(rightKey);
  return left.col - right.col || left.row - right.row;
}

function phaseComplete(phase, boardState) {
  if (phase === 'eat_commits') {
    return boardState.commitPresent.size === 0;
  }
  if (phase === 'place_pattern') {
    return boardState.patternTargets.size > 0 && boardState.patternPresent.size === boardState.patternTargets.size;
  }
  if (phase === 'eat_pattern') {
    return boardState.patternTargets.size > 0 && boardState.patternPresent.size === 0;
  }
  return boardState.commitPresent.size === originalCommitKeys.length;
}

function currentWeightForKey(key, boardState) {
  if (boardState.patternTargets.has(key)) {
    return boardState.patternTargets.get(key).weight;
  }
  const cell = cellsByKey.get(key);
  return contributionGrowth[cell.contributionLevel] ?? 0;
}

function tailWillVacate(length, eventKind) {
  if (eventKind === 'eat_commit' || eventKind === 'eat_pattern') {
    return false;
  }
  return true;
}

function eventKindForMove(moveKey, phase, boardState) {
  if (phase === 'eat_commits' && boardState.commitPresent.has(moveKey)) {
    return 'eat_commit';
  }
  if (phase === 'place_pattern' && boardState.patternTargets.has(moveKey) && !boardState.patternPresent.has(moveKey)) {
    return 'place_pattern';
  }
  if (phase === 'eat_pattern' && boardState.patternPresent.has(moveKey)) {
    return 'eat_pattern';
  }
  if (phase === 'place_commits' && !boardState.commitPresent.has(moveKey) && originalCommitKeys.includes(moveKey)) {
    return 'place_commit';
  }
  return null;
}

function buildBlockedSet(bodyKeys, allowTailVacate) {
  const blocked = new Set(bodyKeys.slice(0, allowTailVacate ? -1 : bodyKeys.length));
  blocked.delete(bodyKeys[0]);
  return blocked;
}

function bfsDistance(startKey, goalKey, blocked) {
  if (startKey === goalKey) {
    return 0;
  }
  const queue = [[startKey, 0]];
  const seen = new Set([startKey]);
  while (queue.length > 0) {
    const [current, distance] = queue.shift();
    for (const next of neighbors(current)) {
      if (blocked.has(next) && next !== goalKey) {
        continue;
      }
      if (seen.has(next)) {
        continue;
      }
      if (next === goalKey) {
        return distance + 1;
      }
      seen.add(next);
      queue.push([next, distance + 1]);
    }
  }
  return Number.POSITIVE_INFINITY;
}

function chooseNextMove(snakeState, boardState, phase) {
  const targets = phaseTargets(phase, boardState);
  if (targets.length === 0) {
    return null;
  }

  const sortedTargets = [...targets].sort((left, right) => manhattan(snakeState.headKey, left) - manhattan(snakeState.headKey, right) || sortKeys(left, right));
  const legalMoves = neighbors(snakeState.headKey).filter((neighbor) => {
    const eventKind = eventKindForMove(neighbor, phase, boardState);
    const allowTail = tailWillVacate(snakeState.currentLength, eventKind);
    const blocked = buildBlockedSet(snakeState.bodyKeys, allowTail);
    return !blocked.has(neighbor);
  });

  if (legalMoves.length === 0) {
    throw new Error(`No legal moves available from ${snakeState.headKey} during ${phase}`);
  }

  let bestMove = legalMoves[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const move of legalMoves) {
    const eventKind = eventKindForMove(move, phase, boardState);
    const allowTail = tailWillVacate(snakeState.currentLength, eventKind);
    const blocked = buildBlockedSet(snakeState.bodyKeys, allowTail);
    blocked.add(snakeState.headKey);

    let moveScore = Number.POSITIVE_INFINITY;
    for (const target of sortedTargets.slice(0, 6)) {
      const distance = bfsDistance(move, target, blocked);
      const heuristic = distance * 1000 + manhattan(move, target) * 10 + parseKey(move).col + parseKey(move).row / 10;
      moveScore = Math.min(moveScore, heuristic);
    }

    if (moveScore < bestScore) {
      bestScore = moveScore;
      bestMove = move;
    }
  }

  return bestMove;
}

function applyMove(moveKey, snakeState, boardState, phase, stepIndex, eventLog) {
  snakeState.headKey = moveKey;
  snakeState.bodyKeys.unshift(moveKey);

  const eventKind = eventKindForMove(moveKey, phase, boardState);
  if (eventKind) {
    const weight = currentWeightForKey(moveKey, boardState);
    eventLog.push({ step: stepIndex, type: eventKind, key: moveKey, weight, patternId: boardState.activePatternId });
    if (eventKind === 'eat_commit') {
      boardState.commitPresent.delete(moveKey);
      snakeState.currentLength = Math.min(maxSnakeLength, snakeState.currentLength + weight);
    }
    if (eventKind === 'place_pattern') {
      boardState.patternPresent.add(moveKey);
      snakeState.currentLength = Math.max(initialSnakeLength, snakeState.currentLength - weight);
    }
    if (eventKind === 'eat_pattern') {
      boardState.patternPresent.delete(moveKey);
      snakeState.currentLength = Math.min(maxSnakeLength, snakeState.currentLength + weight);
    }
    if (eventKind === 'place_commit') {
      boardState.commitPresent.add(moveKey);
      snakeState.currentLength = Math.max(initialSnakeLength, snakeState.currentLength - weight);
    }
  }

  while (snakeState.bodyKeys.length > snakeState.currentLength) {
    snakeState.bodyKeys.pop();
  }
}

function makeStepSnapshot(stepIndex, snakeState, phase, boardState) {
  return {
    step: stepIndex,
    headKey: snakeState.headKey,
    bodyKeys: [...snakeState.bodyKeys],
    phase,
    patternId: boardState.activePatternId,
  };
}

function simulate() {
  const scheduler = createPatternScheduler();
  const boardState = {
    commitPresent: new Set(originalCommitKeys),
    patternTargets: new Map(),
    patternPresent: new Set(),
    activePatternId: null,
  };
  const snakeState = {
    headKey: '0-0',
    bodyKeys: ['0-0', '-1-0', '-2-0'],
    currentLength: initialSnakeLength,
  };

  const steps = [];
  const eventLog = [];
  const patternSequence = [];
  let phase = 'eat_commits';
  let completedPatternCycles = 0;
  let stepIndex = 0;

  for (let offset = 1; offset <= enterPaddingSteps; offset += 1) {
    steps.push({
      step: stepIndex,
      headKey: `-${enterPaddingSteps - offset}-0`,
      bodyKeys: Array.from({ length: initialSnakeLength }, (_, index) => `-${enterPaddingSteps - offset + index}-0`),
      phase: 'spawn',
      patternId: null,
    });
    stepIndex += 1;
  }

  steps.push(makeStepSnapshot(stepIndex, snakeState, phase, boardState));
  stepIndex += 1;

  while (completedPatternCycles < totalCycles) {
    if (phaseComplete(phase, boardState)) {
      if (phase === 'eat_commits') {
        phase = 'place_pattern';
        boardState.activePatternId = scheduler.next();
        boardState.patternTargets = buildPatternById(boardState.activePatternId);
        boardState.patternPresent = new Set();
        patternSequence.push(boardState.activePatternId);
      } else if (phase === 'place_pattern') {
        phase = 'eat_pattern';
      } else if (phase === 'eat_pattern') {
        phase = 'place_commits';
      } else {
        phase = 'eat_commits';
        boardState.activePatternId = null;
        boardState.patternTargets = new Map();
        boardState.patternPresent = new Set();
        completedPatternCycles += 1;
      }
      steps.push(makeStepSnapshot(stepIndex, snakeState, phase, boardState));
      stepIndex += 1;
      continue;
    }

    const moveKey = chooseNextMove(snakeState, boardState, phase);
    applyMove(moveKey, snakeState, boardState, phase, stepIndex, eventLog);
    steps.push(makeStepSnapshot(stepIndex, snakeState, phase, boardState));
    stepIndex += 1;
  }

  return { steps, eventLog, patternSequence };
}

const simulation = simulate();
const LOOP_SECONDS = simulation.steps.length * stepSeconds;
const stepTimes = [...simulation.steps.map((step) => timeForStep(step.step)), LOOP_SECONDS];

function timeForStep(step) {
  return Math.min(step * stepSeconds, LOOP_SECONDS);
}

function formatTimes(times) {
  return times.map((time) => Math.max(0, Math.min(1, time / LOOP_SECONDS)).toFixed(6)).join(';');
}

function buildContinuousPathData() {
  const startPoint = { x: padX - enterPaddingSteps * (cellSize + gap), y: cellY(0) + cellSize / 2 };
  const points = [startPoint];
  for (const step of simulation.steps) {
    const { col, row } = parseKey(step.headKey);
    const x = col < 0 ? padX + col * (cellSize + gap) + cellSize / 2 : cellCenter(col, row).x;
    const y = col < 0 ? cellY(0) + cellSize / 2 : cellCenter(col, row).y;
    points.push({ x, y });
  }
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

const fullPathData = buildContinuousPathData();

function positionForKey(key) {
  const { col, row } = parseKey(key);
  if (col < 0) {
    return { x: padX + col * (cellSize + gap) + cellSize / 2, y: cellY(0) + cellSize / 2 };
  }
  return cellCenter(col, row);
}

function buildSegmentTracks() {
  const maxLength = Math.max(...simulation.steps.map((step) => step.bodyKeys.length));
  return Array.from({ length: maxLength }, (_, index) => {
    const transforms = [];
    const opacities = [];
    for (const step of simulation.steps) {
      const key = step.bodyKeys[index] ?? step.bodyKeys[step.bodyKeys.length - 1] ?? step.headKey;
      const position = positionForKey(key);
      transforms.push(`translate(${position.x.toFixed(2)} ${position.y.toFixed(2)})`);
      opacities.push(index < step.bodyKeys.length ? '1' : '0');
    }
    transforms.push(transforms[transforms.length - 1]);
    opacities.push(opacities[opacities.length - 1]);
    return {
      index,
      transforms,
      opacities,
    };
  });
}

const segmentTracks = buildSegmentTracks();

function buildCommitEvents() {
  const byKey = new Map(originalCommitKeys.map((key) => [key, []]));
  for (const event of simulation.eventLog) {
    if (event.type === 'eat_commit' || event.type === 'place_commit') {
      byKey.get(event.key).push(event);
    }
  }
  return byKey;
}

const commitEvents = buildCommitEvents();

function buildPatternEvents() {
  const byPattern = new Map();
  for (const event of simulation.eventLog) {
    if (event.type !== 'place_pattern' && event.type !== 'eat_pattern') {
      continue;
    }
    if (!byPattern.has(event.patternId)) {
      byPattern.set(event.patternId, new Map());
    }
    const patternMap = byPattern.get(event.patternId);
    if (!patternMap.has(event.key)) {
      patternMap.set(event.key, []);
    }
    patternMap.get(event.key).push(event);
  }
  return byPattern;
}

const patternEvents = buildPatternEvents();

function buildCommitAnimation(cell, theme) {
  const events = commitEvents.get(cellKey(cell)) ?? [];
  return buildPlacedSquareAnimation(events, theme.original[cell.contributionLevel], cellX(cell.col), cellY(cell.row), true);
}

function buildPlacedSquareAnimation(events, fill, x, y, initiallyVisible) {
  const tiny = 1.2;
  const centerX = x + cellSize / 2;
  const centerY = y + cellSize / 2;
  const tinyX = centerX - tiny / 2;
  const tinyY = centerY - tiny / 2;
  const valuesOpacity = [initiallyVisible ? '1' : '0'];
  const valuesX = [initiallyVisible ? `${x}` : `${tinyX}`];
  const valuesY = [initiallyVisible ? `${y}` : `${tinyY}`];
  const valuesWidth = [initiallyVisible ? `${cellSize}` : `${tiny}`];
  const valuesHeight = [initiallyVisible ? `${cellSize}` : `${tiny}`];
  const valuesRx = [initiallyVisible ? '2.4' : '0.8'];
  const times = [0];

  for (const event of events) {
    const eventTime = timeForStep(event.step);
    if (event.type === 'place_pattern' || event.type === 'place_commit') {
      valuesOpacity.push('0', '1');
      valuesX.push(`${tinyX}`, `${x}`);
      valuesY.push(`${tinyY}`, `${y}`);
      valuesWidth.push(`${tiny}`, `${cellSize}`);
      valuesHeight.push(`${tiny}`, `${cellSize}`);
      valuesRx.push('0.8', '2.4');
      times.push(eventTime, Math.min(eventTime + 0.18, LOOP_SECONDS));
    }
    if (event.type === 'eat_pattern' || event.type === 'eat_commit') {
      valuesOpacity.push('1', '0');
      valuesX.push(`${x}`, `${x}`);
      valuesY.push(`${y}`, `${y}`);
      valuesWidth.push(`${cellSize}`, `${cellSize}`);
      valuesHeight.push(`${cellSize}`, `${cellSize}`);
      valuesRx.push('2.4', '2.4');
      times.push(eventTime, Math.min(eventTime + 0.001, LOOP_SECONDS));
    }
  }

  valuesOpacity.push(valuesOpacity[valuesOpacity.length - 1]);
  valuesX.push(valuesX[valuesX.length - 1]);
  valuesY.push(valuesY[valuesY.length - 1]);
  valuesWidth.push(valuesWidth[valuesWidth.length - 1]);
  valuesHeight.push(valuesHeight[valuesHeight.length - 1]);
  valuesRx.push(valuesRx[valuesRx.length - 1]);
  times.push(LOOP_SECONDS);

  return `<rect x="${tinyX}" y="${tinyY}" width="${tiny}" height="${tiny}" rx="0.8" fill="${fill}" opacity="0">
    <animate attributeName="opacity" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="${valuesOpacity.join(';')}" keyTimes="${formatTimes(times)}" />
    <animate attributeName="x" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="${valuesX.join(';')}" keyTimes="${formatTimes(times)}" />
    <animate attributeName="y" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="${valuesY.join(';')}" keyTimes="${formatTimes(times)}" />
    <animate attributeName="width" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="${valuesWidth.join(';')}" keyTimes="${formatTimes(times)}" />
    <animate attributeName="height" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="${valuesHeight.join(';')}" keyTimes="${formatTimes(times)}" />
    <animate attributeName="rx" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="${valuesRx.join(';')}" keyTimes="${formatTimes(times)}" />
  </rect>`;
}

function buildCommitRects(theme) {
  return cells.filter((cell) => cell.active).map((cell) => {
    const fill = theme.original[cell.contributionLevel];
    const events = commitEvents.get(cellKey(cell)) ?? [];
    return buildPlacedSquareAnimation(events, fill, cellX(cell.col), cellY(cell.row), true);
  }).join('');
}

function buildPatternRects(theme) {
  return patternIds.map((patternId) => {
    const cellsForPattern = buildPatternById(patternId);
    const eventsForPattern = patternEvents.get(patternId) ?? new Map();
    return [...cellsForPattern.values()].map((patternCell) => {
      const events = eventsForPattern.get(patternCell.key) ?? [];
      if (events.length === 0) {
        return '';
      }
      const fill = theme.patternPalettes[patternId][patternCell.weight - 1];
      return buildPlacedSquareAnimation(events, fill, cellX(patternCell.col), cellY(patternCell.row));
    }).join('');
  }).join('');
}

function buildSnake(theme) {
  return `<g id="snake">
    <path id="snake-path" d="${fullPathData}" fill="none" stroke="none" />
    ${segmentTracks.map((track) => {
      const scale = Math.max(0.55, 1 - track.index * 0.018);
      const markup = track.index === 0
        ? `      <g>
        <ellipse cx="0" cy="0" rx="8.6" ry="7.2" fill="${theme.snakeBodyGlow}" />
        <ellipse cx="0" cy="0" rx="6.8" ry="5.8" fill="${theme.snakeBody}" />
        <circle cx="2.3" cy="-2.1" r="0.9" fill="#ffffff" />
        <circle cx="2.3" cy="2.1" r="0.9" fill="#ffffff" />
        <circle cx="3.2" cy="-2.1" r="0.36" fill="#111827" />
        <circle cx="3.2" cy="2.1" r="0.36" fill="#111827" />
      </g>`
        : `<g opacity="${Math.max(0.55, 0.96 - track.index * 0.012).toFixed(2)}"><ellipse cx="0" cy="0" rx="${(5.9 * scale).toFixed(2)}" ry="${(5.1 * scale).toFixed(2)}" fill="${theme.snakeBodyGlow}" /><ellipse cx="0" cy="0" rx="${(4.8 * scale).toFixed(2)}" ry="${(4.15 * scale).toFixed(2)}" fill="${theme.snakeBody}" /></g>`;
      return `<g opacity="0" transform="${track.transforms[0]}">
        <animate attributeName="opacity" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="${track.opacities.join(';')}" keyTimes="${formatTimes(stepTimes)}" />
        <animateTransform attributeName="transform" type="translate" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="discrete" values="${track.transforms.map((value) => value.replace('translate(', '').replace(')', '')).join(';')}" keyTimes="${formatTimes(stepTimes)}" />
        ${markup}
      </g>`;
    }).join('')}
  </g>`;
}

function buildSvg(theme) {
  const gridRects = cells.map((cell) => {
    const x = cellX(cell.col);
    const y = cellY(cell.row);
    const fill = theme.grid;
    const animation = cell.active ? buildCommitAnimation(cell, theme) : '';
    return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2.4" fill="${fill}" stroke="${theme.gridStroke}" stroke-width="0.6">${animation}</rect>`;
  }).join('');

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Animated GitHub contribution grid">
  <defs>
  </defs>
  <rect width="${width}" height="${height}" rx="${frameRadius}" fill="${theme.background}" />
  <rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="${frameRadius - 0.75}" stroke="${theme.frame}" stroke-width="1.5" />
  ${gridRects}
  ${buildCommitRects(theme)}
  ${buildPatternRects(theme)}
  ${buildSnake(theme)}
</svg>`;
}

await mkdir('dist', { recursive: true });
await writeFile('dist/github-contribution-grid-snake.svg', buildSvg(themes.light));
await writeFile('dist/github-contribution-grid-snake-dark.svg', buildSvg(themes.dark));
