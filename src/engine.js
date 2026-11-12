/** Deterministic, solvable puzzles on the six independent surfaces of a cube. */
export const MIN_SIZE = 2;
export const MAX_SIZE = 64;
const DIRECTIONS = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];
const indexes = new WeakMap();

function hashSeed(seed) {
  const text = String(seed);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function seededRandom(seed) {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const inside = (x, y, size) => x >= 0 && y >= 0 && x < size && y < size;
const cellKey = (face, x, y, size) => face * size * size + y * size + x;

function weightedPick(items, weights, random) {
  let cursor = random() * weights.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < items.length; i++) {
    cursor -= weights[i];
    if (cursor <= 0) return items[i];
  }
  return items.at(-1);
}

/**
 * Construct a certified solution by carving arrows in REMOVAL order.
 *
 * Initially every grid cell is considered occupied. Each chosen head has a clear
 * ray to an edge, and its tail grows only through still-occupied adjacent cells.
 * Carving those cells makes them empty for subsequent arrows. When the carved
 * arrows are assembled into the starting board, removing them in carve order
 * exactly recreates these empty corridors. Any uncarved isolated cells are left
 * blank, which can only remove obstructions. Thus the recorded solution works.
 *
 * More strongly, removing any currently legal arrow only removes obstacles;
 * it cannot make a previously legal move illegal or create a deadlock.
 * Cells are ordered tail -> head. Face indices are 0..5; x/y are face-local.
 */
export function generatePuzzle(size, seed = Date.now()) {
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
    throw new RangeError(`Cube dimensions must be an integer from ${MIN_SIZE} to ${MAX_SIZE}.`);
  }
  const random = seededRandom(seed);
  const arrows = [];
  const solution = [];

  for (let face = 0; face < 6; face++) {
    const remaining = new Uint8Array(size * size).fill(1);
    const occupied = (x, y) => inside(x, y, size) && remaining[y * size + x] === 1;
    const remove = ({ x, y }) => { remaining[y * size + x] = 0; };

    while (true) {
      // Only the first occupied cell seen from a given edge can be a head.
      // Four linear sweeps find all such heads without testing O(N)-long rays
      // from every cell. A second cell behind the head ensures length >= 2.
      const candidates = [];
      const add = (x, y, direction) => {
        if (occupied(x - direction.x, y - direction.y)) candidates.push({ x, y, direction });
      };
      for (let line = 0; line < size; line++) {
        for (let x = 0; x < size; x++) if (occupied(x, line)) { add(x, line, DIRECTIONS[0]); break; }
        for (let x = size - 1; x >= 0; x--) if (occupied(x, line)) { add(x, line, DIRECTIONS[1]); break; }
        for (let y = 0; y < size; y++) if (occupied(line, y)) { add(line, y, DIRECTIONS[2]); break; }
        for (let y = size - 1; y >= 0; y--) if (occupied(line, y)) { add(line, y, DIRECTIONS[3]); break; }
      }
      if (candidates.length === 0) break;

      // Prefer inward heads as corridors emerge: these create dependencies,
      // instead of filling the board entirely with immediately removable arrows.
      const head = weightedPick(candidates, candidates.map(({ x, y, direction }) => {
        const depth = direction.x === -1 ? x : direction.x === 1 ? size - 1 - x
          : direction.y === -1 ? y : size - 1 - y;
        return 1 + depth * 1.7;
      }), random);
      const headToTail = [{ x: head.x, y: head.y }, { x: head.x - head.direction.x, y: head.y - head.direction.y }];
      headToTail.forEach(remove);
      const lengthChoice = random();
      const maxLength = Math.min(size * size, size * 2 + 1);
      const targetLength = lengthChoice < 0.25
        ? 2 + Math.floor(random() * Math.min(3, maxLength - 1))
        : 3 + Math.floor(random() * Math.max(1, maxLength - 2));

      while (headToTail.length < targetLength) {
        const last = headToTail.at(-1);
        const previous = headToTail.at(-2);
        const choices = DIRECTIONS.map(direction => ({ x: last.x + direction.x, y: last.y + direction.y }))
          .filter(({ x, y }) => occupied(x, y));
        if (choices.length === 0) break;
        const next = weightedPick(choices, choices.map(({ x, y }) => {
          const onward = DIRECTIONS.filter(direction => occupied(x + direction.x, y + direction.y)).length;
          const turns = x - last.x !== last.x - previous.x || y - last.y !== last.y - previous.y;
          return (turns ? 2.1 : 1) * (onward === 0 ? 1.4 : 1 / Math.sqrt(onward));
        }), random);
        headToTail.push(next);
        remove(next);
      }

      const id = arrows.length;
      arrows.push({ id, face, cells: headToTail.reverse(), direction: { ...head.direction } });
      solution.push(id);
    }
  }
  return { size, seed, arrows, solution };
}

function indexPuzzle(puzzle) {
  let index = indexes.get(puzzle);
  if (index) return index;
  const cells = new Map();
  const arrows = new Map();
  for (const arrow of puzzle.arrows) {
    arrows.set(arrow.id, arrow);
    for (const cell of arrow.cells) cells.set(cellKey(arrow.face, cell.x, cell.y, puzzle.size), arrow.id);
  }
  index = { cells, arrows };
  indexes.set(puzzle, index);
  return index;
}

/** Return the first obstructing arrow ID, or null if the exit ray is clear. */
export function getBlockingArrow(puzzle, id, removed = new Set()) {
  const index = indexPuzzle(puzzle);
  const arrow = index.arrows.get(id);
  if (!arrow || removed.has(id)) return null;
  const head = arrow.cells.at(-1);
  let x = head.x + arrow.direction.x;
  let y = head.y + arrow.direction.y;
  while (inside(x, y, puzzle.size)) {
    const blocker = index.cells.get(cellKey(arrow.face, x, y, puzzle.size));
    if (blocker !== undefined && !removed.has(blocker)) return blocker;
    x += arrow.direction.x;
    y += arrow.direction.y;
  }
  return null;
}

export function canRemove(puzzle, id, removed = new Set()) {
  return !removed.has(id) && indexPuzzle(puzzle).arrows.has(id) && getBlockingArrow(puzzle, id, removed) === null;
}

export function getRemovable(puzzle, removed = new Set()) {
  return puzzle.arrows.filter(arrow => canRemove(puzzle, arrow.id, removed));
}
