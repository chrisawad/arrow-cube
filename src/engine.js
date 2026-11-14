import { neighbor, getGridSize, getGridSizeForVersion, FACE_BASIS, directionBetween } from './cube-surface.js';
import { orientArrow } from './arrow-orientation.js';
import { traceExitRoute, surfaceCellKey } from './routing.js';
import { buildFeaturePuzzle } from './feature-generator.js';

/** Deterministic, solvable puzzles covering the surface of a cube. */
export const MIN_SIZE = 2;
export const MAX_SIZE = 64;
// Persist this with a saved board: seed mappings are stable within a version.
export const GENERATOR_VERSION = 11;
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
 * exactly recreates these empty corridors. Version 2 fills isolated cells with
 * short one-cell arrows, so every face is completely covered. Version 1 leaves
 * those cells blank; this can only remove obstructions. Both are solvable.
 *
 * More strongly, removing any currently legal arrow only removes obstacles;
 * it cannot make a previously legal move illegal or create a deadlock.
 * Cells are ordered tail -> head. Face indices are 0..5; x/y are face-local.
 */
export function generatePuzzle(size, seed = Date.now(), generatorVersion = GENERATOR_VERSION) {
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
    throw new RangeError(`Cube dimensions must be an integer from ${MIN_SIZE} to ${MAX_SIZE}.`);
  }
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(generatorVersion)) throw new RangeError('Unsupported puzzle generator version.');
  if (generatorVersion === 11) return generateSpecialPuzzle(size, seed);
  if (generatorVersion >= 7) return generateExtendedPuzzle(size, seed, generatorVersion);
  if (generatorVersion >= 5) return generateRandomPuzzle(size, seed, generatorVersion);
  if (generatorVersion === 4) return generateLongPuzzle(size, seed);
  if (generatorVersion === 3) return generateWrappedPuzzle(size, seed);
  const dense = generatorVersion === 2;
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
      // from every cell. Legacy boards require a second cell behind the head;
      // dense boards also use single-cell arrows to fill every remaining gap.
      const candidates = [];
      const add = (x, y, direction) => {
        if (dense || occupied(x - direction.x, y - direction.y)) candidates.push({ x, y, direction });
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
        // Strongly reuse carved corridors in dense boards. Their arrows point
        // into earlier pieces, building dependency chains rather than providing
        // a board full of independent outward-facing edge arrows.
        return dense ? (1 + depth ** 3 * 2) * (occupied(x - direction.x, y - direction.y) ? 6 : 1)
          : 1 + depth * 1.7;
      }), random);
      const behind = { x: head.x - head.direction.x, y: head.y - head.direction.y };
      const headToTail = [{ x: head.x, y: head.y }];
      if (!dense || occupied(behind.x, behind.y)) headToTail.push(behind);
      headToTail.forEach(remove);
      const lengthChoice = random();
      const maxLength = Math.min(size * size, size * 2 + 1);
      const targetLength = dense
        ? lengthChoice < 0.24 ? 2 : lengthChoice < 0.64 ? 3 : lengthChoice < 0.87 ? 4
          : lengthChoice < 0.96 ? 5 + Math.floor(random() * 2)
            : 7 + Math.floor(random() * Math.max(1, Math.min(12, maxLength) - 6))
        : lengthChoice < 0.25 ? 2 + Math.floor(random() * Math.min(3, maxLength - 1))
          : 3 + Math.floor(random() * Math.max(1, maxLength - 2));

      // A singleton with no cell directly behind it cannot bend its first
      // segment sideways: its visible arrowhead must retain the chosen exit.
      while (headToTail.length >= 2 && headToTail.length < targetLength) {
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
  return { size, seed, generatorVersion, arrows, solution };
}

/** Weighted frontier sampler: O(log N) selections/updates instead of full-board scans. */
class FrontierWeights {
  constructor(count) { this.values = new Float64Array(count); this.tree = new Float64Array(count + 1); this.total = 0; }
  set(index, value) {
    const change = value - this.values[index];
    this.values[index] = value; this.total += change;
    for (let i = index + 1; i < this.tree.length; i += i & -i) this.tree[i] += change;
  }
  pick(random) {
    let value = random() * this.total, index = 0;
    let bit = 1; while (bit * 2 < this.tree.length) bit *= 2;
    for (; bit; bit >>= 1) {
      const next = index + bit;
      if (next < this.tree.length && this.tree[next] <= value) { value -= this.tree[next]; index = next; }
    }
    return Math.min(index, this.values.length - 1);
  }
}

/**
 * Version 3 doubles surface lanes and grows paths over real cube edges. Heads
 * still leave their current face along a clear straight ray. The global carve
 * order proves solvability even when an arrow's body crosses several faces.
 * Only 24*N monotone visibility frontiers are maintained; removing a cell updates
 * its row/column frontiers and at most four neighboring head candidates.
 */
function generateWrappedPuzzle(size, seed, gridSize = size * 2, extended = false, maxLength = 96) {
  const area = gridSize * gridSize, totalCells = area * 6;
  const random = seededRandom(seed);
  const remaining = new Uint8Array(totalCells).fill(1);
  const owner = new Int32Array(totalCells).fill(-1);
  const steps = new Int32Array(totalCells * 4);
  const stepDirections = new Uint8Array(totalCells * 4);
  const faceOf = index => Math.floor(index / area);
  const cellOf = index => ({ face: faceOf(index), x: index % gridSize, y: Math.floor(index % area / gridSize) });
  const indexOf = cell => cell.face * area + cell.y * gridSize + cell.x;
  const directionIndex = direction => direction.x === -1 ? 0 : direction.x === 1 ? 1 : direction.y === -1 ? 2 : 3;
  const opposite = direction => direction ^ 1;

  for (let index = 0; index < totalCells; index++) {
    const cell = cellOf(index);
    for (let d = 0; d < 4; d++) {
      const direction = DIRECTIONS[d], x = cell.x + direction.x, y = cell.y + direction.y;
      if (inside(x, y, gridSize)) {
        steps[index * 4 + d] = cell.face * area + y * gridSize + x;
        stepDirections[index * 4 + d] = d;
      } else {
        const next = neighbor(cell, direction, gridSize);
        steps[index * 4 + d] = indexOf(next.cell);
        stepDirections[index * 4 + d] = directionIndex(next.direction);
      }
    }
  }

  const slots = 24 * gridSize;
  const frontier = new Int32Array(slots);
  const heads = new Int32Array(slots).fill(-1);
  const weights = new FrontierWeights(slots);
  const slotOf = (index, d) => {
    const face = faceOf(index), local = index % area;
    return (face * 4 + d) * gridSize + (d < 2 ? Math.floor(local / gridSize) : local % gridSize);
  };
  for (let slot = 0; slot < slots; slot++) frontier[slot] = Math.floor(slot / gridSize) % 2 === 0 ? 0 : gridSize - 1;
  function refresh(slot) {
    const line = slot % gridSize, plane = Math.floor(slot / gridSize);
    const d = plane % 4, face = Math.floor(plane / 4), increment = d % 2 ? -1 : 1;
    let coordinate = frontier[slot], index = -1;
    while (coordinate >= 0 && coordinate < gridSize) {
      index = face * area + (d < 2 ? line * gridSize + coordinate : coordinate * gridSize + line);
      if (remaining[index]) break;
      coordinate += increment;
    }
    frontier[slot] = coordinate;
    if (coordinate < 0 || coordinate >= gridSize) { heads[slot] = -1; weights.set(slot, 0); return; }
    heads[slot] = index;
    const depth = d % 2 ? gridSize - 1 - coordinate : coordinate;
    const behind = steps[index * 4 + opposite(d)];
    const connected = remaining[behind] ? 12 : 0.2;
    const wraps = faceOf(behind) !== face ? 2.6 : 1;
    weights.set(slot, (1 + depth * depth * 2) * connected * wraps);
  }
  for (let slot = 0; slot < slots; slot++) refresh(slot);

  const carved = [];
  let cellsLeft = totalCells;
  while (cellsLeft > 0) {
    const slot = weights.pick(random), headIndex = heads[slot];
    if (headIndex < 0) throw new Error('Surface frontier unexpectedly empty.');
    const headDirection = Math.floor(slot / gridSize) % 4;
    const headToTail = [headIndex], affected = new Set();
    const remove = index => {
      remaining[index] = 0; cellsLeft--;
      owner[index] = carved.length;
      for (let d = 0; d < 4; d++) {
        affected.add(slotOf(index, d));
        affected.add(slotOf(steps[index * 4 + d], stepDirections[index * 4 + d]));
      }
    };
    remove(headIndex);
    let walkDirection = opposite(headDirection);
    const behind = steps[headIndex * 4 + walkDirection];
    if (remaining[behind]) {
      walkDirection = stepDirections[headIndex * 4 + walkDirection];
      headToTail.push(behind); remove(behind);
    }
    const roll = random();
    const targetLength = extended ? Math.min(maxLength, gridSize * 8,
      roll < 0.48 ? 6 + Math.floor(random() * 11)
        : roll < 0.78 ? 20 + Math.floor(random() * 21) : 48 + Math.floor(random() * 49)) : Math.min(gridSize * 2,
      roll < 0.75 ? 4 + Math.floor(random() * 7)
        : roll < 0.94 ? 11 + Math.floor(random() * 6)
          : 17 + Math.floor(random() * Math.min(gridSize, 16)));
    if (extended && headToTail.length >= 2) {
      // A bounded, randomized depth-first search can turn around a dead end
      // instead of immediately abandoning a long target. Only provisional tail
      // cells are rewound; the head, neck and certified clear exit stay fixed.
      const frames = [], headings = [opposite(headDirection), walkDirection];
      let best = headToTail.slice(), visits = 0;
      const rewind = () => {
        const index = headToTail.pop();
        remaining[index] = 1; cellsLeft++; owner[index] = -1; headings.pop();
      };
      while (headToTail.length >= 2 && visits++ < 128 + targetLength * 12) {
        if (headToTail.length > best.length) best = headToTail.slice();
        if (headToTail.length >= targetLength) break;
        const depth = headToTail.length, last = headToTail.at(-1);
        let frame = frames[depth];
        if (!frame) {
          frame = { choices: [], weights: [] };
          for (let d = 0; d < 4; d++) {
            const next = steps[last * 4 + d];
            if (!remaining[next]) continue;
            let onward = 0;
            for (let nextD = 0; nextD < 4; nextD++) onward += remaining[steps[next * 4 + nextD]];
            frame.choices.push(d);
            frame.weights.push((faceOf(last) !== faceOf(next) ? 5 : 1)
              * (d === headings.at(-1) ? 1 : 1.8) * (onward ? 1 / Math.sqrt(onward) : 0.25));
          }
          frames[depth] = frame;
        }
        if (!frame.choices.length) {
          frames[depth] = undefined;
          if (depth === 2) break;
          rewind();
          continue;
        }
        const d = weightedPick(frame.choices, frame.weights, random), position = frame.choices.indexOf(d);
        frame.choices.splice(position, 1); frame.weights.splice(position, 1);
        const next = steps[last * 4 + d];
        headToTail.push(next); headings.push(stepDirections[last * 4 + d]); remove(next);
      }
      if (headToTail.length > best.length) best = headToTail.slice();
      while (headToTail.length > 2) rewind();
      for (const index of best.slice(2)) { headToTail.push(index); remove(index); }
    } else while (headToTail.length >= 2 && headToTail.length < targetLength) {
      const last = headToTail.at(-1), choices = [], choiceWeights = [];
      for (let d = 0; d < 4; d++) {
        const next = steps[last * 4 + d];
        if (!remaining[next]) continue;
        let onward = 0;
        for (let nextD = 0; nextD < 4; nextD++) onward += remaining[steps[next * 4 + nextD]];
        const wraps = faceOf(last) !== faceOf(next);
        choices.push(d);
        choiceWeights.push((wraps ? 7 : 1) * (d === walkDirection ? 1 : 1.7) * (onward === 0 ? 1.4 : 1 / Math.sqrt(onward)));
      }
      if (!choices.length) break;
      const d = weightedPick(choices, choiceWeights, random);
      const next = steps[last * 4 + d];
      walkDirection = stepDirections[last * 4 + d];
      headToTail.push(next); remove(next);
    }
    carved.push({ id: carved.length, face: faceOf(headIndex), indices: headToTail.reverse(), direction: { ...DIRECTIONS[headDirection] } });
    for (const changed of affected) refresh(changed);
  }

  // Absorb tiny leftover arrows into an adjacent EARLIER arrow's tail. Earlier
  // arrows were created while this cell was still occupied, so their exit rays
  // cannot touch it. Moving its removal earlier can only clear more space.
  for (let id = carved.length - 1; id >= 0; id--) {
    const arrow = carved[id];
    if (arrow.indices.length !== 1) continue;
    const index = arrow.indices[0];
    for (let d = 0; d < 4; d++) {
      const adjacent = steps[index * 4 + d], otherId = owner[adjacent];
      const other = carved[otherId];
      if (otherId >= id || !other || other.indices[0] !== adjacent || other.indices.length >= 32) continue;
      if (other.indices.length === 1) {
        const requiredBehind = steps[adjacent * 4 + opposite(directionIndex(other.direction))];
        if (requiredBehind !== index) continue;
      }
      other.indices.unshift(index); owner[index] = otherId; arrow.indices.length = 0;
      break;
    }
  }
  const arrows = carved.filter(arrow => arrow.indices.length).map((arrow, id) => ({
    id, face: arrow.face, cells: arrow.indices.map(cellOf), direction: arrow.direction,
  }));
  return { size, gridSize, seed, generatorVersion: 3, arrows, solution: arrows.map(arrow => arrow.id) };
}

/**
 * Version 4 starts with a Hamiltonian sweep of the entire cube. The top and
 * bottom are serpentine rectangles; the four side faces are one unfolded belt.
 * At EVERY sweep position, the direction opposite the next step points through
 * already swept cells to the current face's edge. Cutting this sweep into any
 * chunks of at least five cells therefore gives a fully covered, solved-order
 * partition, even on the smallest 4-by-4 face grid.
 *
 * Random tail transfers add bends and seam crossings. A transferred prefix must
 * belong to a LATER arrow, and its donor must retain at least five cells. Earlier
 * head rays never crossed those later cells, so transferring their removal
 * earlier preserves every certified move. No retries or deleted cells are needed.
 */
function generateLongPuzzle(size, seed) {
  const gridSize = size * 2, area = gridSize * gridSize;
  const random = seededRandom(seed), sweep = [];
  const addFace = face => {
    for (let y = 0; y < gridSize; y++) for (let step = 0; step < gridSize; step++) {
      sweep.push({ face, x: y % 2 ? gridSize - 1 - step : step, y });
    }
  };
  addFace(4);
  for (let y = 0; y < gridSize; y++) for (let step = 0; step < gridSize * 4; step++) {
    const position = y % 2 ? gridSize * 4 - 1 - step : step;
    sweep.push({ face: Math.floor(position / gridSize), x: position % gridSize, y });
  }
  addFace(5);

  // Choose one of the 24 proper rotations of the cube. Integer transforms keep
  // this seed mapping exact while varying which faces carry the long belt.
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const xAxis = FACE_BASIS[Math.floor(random() * 6)].normal;
  const yChoices = FACE_BASIS.map(basis => basis.normal).filter(normal => dot(normal, xAxis) === 0);
  const yAxis = yChoices[Math.floor(random() * 4)];
  const zAxis = [xAxis[1] * yAxis[2] - xAxis[2] * yAxis[1], xAxis[2] * yAxis[0] - xAxis[0] * yAxis[2], xAxis[0] * yAxis[1] - xAxis[1] * yAxis[0]];
  const rotate = vector => xAxis.map((value, i) => value * vector[0] + yAxis[i] * vector[1] + zAxis[i] * vector[2]);
  const rotations = FACE_BASIS.map(basis => {
    const normal = rotate(basis.normal), u = rotate(basis.u), v = rotate(basis.v);
    const face = FACE_BASIS.findIndex(other => dot(normal, other.normal) === 1);
    const target = FACE_BASIS[face];
    return { face, xx: dot(u, target.u), xy: dot(v, target.u), yx: dot(u, target.v), yy: dot(v, target.v) };
  });
  for (const cell of sweep) {
    const transform = rotations[cell.face], x = cell.x * 2 - gridSize + 1, y = cell.y * 2 - gridSize + 1;
    cell.face = transform.face;
    cell.x = (transform.xx * x + transform.xy * y + gridSize - 1) / 2;
    cell.y = (transform.yx * x + transform.yy * y + gridSize - 1) / 2;
  }

  const arrows = [], owner = new Int32Array(6 * area);
  const key = cell => cellKey(cell.face, cell.x, cell.y, gridSize);
  for (let cursor = 0; cursor < sweep.length;) {
    const remaining = sweep.length - cursor;
    let length = 5 + Math.floor(random() * 9);
    if (remaining - length < 5) length = remaining;
    const cells = sweep.slice(cursor, cursor + length).reverse();
    const head = cells.at(-1), neck = cells.at(-2);
    const backwards = directionBetween(head, neck, gridSize);
    const id = arrows.length;
    arrows.push({ id, face: head.face, cells, direction: { x: -backwards.x || 0, y: -backwards.y || 0 } });
    for (const cell of cells) owner[key(cell)] = id;
    cursor += length;
  }

  const order = arrows.map(arrow => arrow.id);
  for (let pass = 0; pass < 5; pass++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const id of order) {
      const arrow = arrows[id];
      if (arrow.cells.length >= 24) continue;
      const tail = arrow.cells[0], options = [], weights = [];
      for (const direction of DIRECTIONS) {
        const adjacent = neighbor(tail, direction, gridSize).cell;
        const donorId = owner[key(adjacent)];
        if (donorId <= id) continue;
        const donor = arrows[donorId];
        const position = donor.cells.findIndex(cell => cell.face === adjacent.face && cell.x === adjacent.x && cell.y === adjacent.y);
        const available = Math.min(donor.cells.length - 5, 24 - arrow.cells.length);
        if (position < 0 || available <= position) continue;
        const length = position === 0 ? 1 + Math.floor(random() * Math.min(available, 6)) : position + 1;
        const towardsHead = directionBetween(tail, arrow.cells[1], gridSize);
        const bends = direction.x !== -towardsHead.x || direction.y !== -towardsHead.y;
        options.push({ donor, length, reverse: position === 0 });
        weights.push((adjacent.face !== tail.face ? 8 : 1) * (bends ? 5 : 0.25));
      }
      if (!options.length) continue;
      const choice = weightedPick(options, weights, random);
      const prefix = choice.donor.cells.splice(0, choice.length);
      for (const cell of prefix) owner[key(cell)] = id;
      if (choice.reverse) prefix.reverse();
      arrow.cells.unshift(...prefix);
    }
  }
  return { size, gridSize, seed, generatorVersion: 4, arrows, solution: arrows.map(arrow => arrow.id) };
}

/**
 * Version 5 returns to the randomly carved surface paths, which turn freely in
 * all four local directions rather than following a sweep. Prefer longer paths
 * by joining 1–4-cell pieces to earlier tails whenever either endpoint fits.
 * An earlier head's exit ray was already clear while every later piece existed;
 * moving a later piece's removal earlier therefore preserves the solution.
 * Unmerged 3–4-cell paths are allowed; remaining 1–2-cell paths become gaps.
 * Removing those obstacles can only make the certified solution easier.
 * Version 6 uses the same process with fewer lanes, leaving room for thicker
 * visible paths. Versions 3–5 retain their original doubled lane counts.
 */
function generateRandomPuzzle(size, seed, generatorVersion, extended = false, maxLength = 96) {
  const puzzle = generateWrappedPuzzle(size, seed, getGridSizeForVersion(size, generatorVersion), extended, maxLength), { gridSize } = puzzle;
  const random = seededRandom(`${seed}:long-paths`);
  const original = puzzle.arrows, owner = new Int32Array(6 * gridSize * gridSize).fill(-1);
  const key = cell => cellKey(cell.face, cell.x, cell.y, gridSize);
  for (const arrow of original) for (const cell of arrow.cells) owner[key(cell)] = arrow.id;

  for (let id = original.length - 1; id >= 0; id--) {
    const source = original[id];
    if (source.cells.length >= 5 || !source.cells.length) continue;
    const choices = [], weights = [];
    const endpoints = source.cells.length === 1 ? [0] : [0, source.cells.length - 1];
    for (const endpoint of endpoints) {
      const end = source.cells[endpoint];
      for (const direction of DIRECTIONS) {
        const adjacent = neighbor(end, direction, gridSize).cell;
        const recipientId = owner[key(adjacent)];
        if (recipientId < 0 || recipientId >= id) continue;
        const recipient = original[recipientId];
        if (!recipient.cells.length || key(recipient.cells[0]) !== key(adjacent)
          || recipient.cells.length + source.cells.length > (extended ? maxLength : 32)) continue;
        if (recipient.cells.length === 1) {
          const behind = neighbor(adjacent, { x: -recipient.direction.x, y: -recipient.direction.y }, gridSize).cell;
          if (key(behind) !== key(end)) continue;
        }
        choices.push({ recipient, reverse: endpoint === 0 });
        // Favor joins across creases and combinations that promote two small
        // pieces to one substantial path, while retaining seeded variety.
        weights.push((end.face !== adjacent.face ? 4 : 1) * (recipient.cells.length < 5 ? 2 : 1));
      }
    }
    if (!choices.length) continue;
    const { recipient, reverse } = weightedPick(choices, weights, random);
    const prefix = reverse ? source.cells.slice().reverse() : source.cells;
    recipient.cells.unshift(...prefix);
    for (const cell of prefix) owner[key(cell)] = recipient.id;
    source.cells = [];
  }
  const arrows = original.filter(arrow => arrow.cells.length >= 3).map((arrow, id) => ({ ...arrow, id }));
  return { size, gridSize, seed, generatorVersion, arrows, solution: arrows.map(arrow => arrow.id) };
}

/**
 * Version 7 joins complete later paths onto earlier tails. The receiving head
 * never changes; its clear exit ray could not have contained any later path.
 * Every join therefore moves cells earlier in the certified solution without
 * introducing a blocker. Seeded target lengths mix ordinary winding paths with
 * much longer ones, rather than stretching every arrow to the same maximum.
 * Version 8 caps those targets and all merges at 72, retaining ordinary targets.
 * Version 9 reduces the cap to 50 without changing saved boards from prior versions.
 * Version 10 allows paths up to 75 cells, retaining the same mix of target lengths.
 */
function generateExtendedPuzzle(size, seed, generatorVersion) {
  const maxLength = generatorVersion >= 10 ? 75 : generatorVersion === 9 ? 50 : generatorVersion === 8 ? 72 : 96;
  const puzzle = generateRandomPuzzle(size, seed, generatorVersion, true, maxLength), { gridSize } = puzzle;
  const random = seededRandom(`${seed}:extended-paths`), original = puzzle.arrows;
  const owner = new Int32Array(6 * gridSize * gridSize).fill(-1);
  const key = cell => cellKey(cell.face, cell.x, cell.y, gridSize);
  const targets = original.map(() => {
    const roll = random();
    return Math.min(maxLength, roll < 0.35 ? 20 + Math.floor(random() * 13)
      : roll < 0.7 ? 40 + Math.floor(random() * 25) : 72 + Math.floor(random() * 25));
  });
  for (const arrow of original) for (const cell of arrow.cells) owner[key(cell)] = arrow.id;
  for (let id = original.length - 1; id >= 0; id--) {
    const source = original[id];
    if (!source.cells.length) continue;
    const choices = [], weights = [];
    for (const endpoint of [0, source.cells.length - 1]) {
      const end = source.cells[endpoint];
      for (const direction of DIRECTIONS) {
        const adjacent = neighbor(end, direction, gridSize).cell, recipientId = owner[key(adjacent)];
        if (recipientId < 0 || recipientId >= id) continue;
        const recipient = original[recipientId];
        if (!recipient.cells.length || key(recipient.cells[0]) !== key(adjacent)
          || recipient.cells.length + source.cells.length > targets[recipientId]) continue;
        choices.push({ recipient, reverse: endpoint === 0 });
        weights.push((end.face !== adjacent.face ? 2 : 1) * (1 + recipient.cells.length / 12));
      }
    }
    if (!choices.length) continue;
    const { recipient, reverse } = weightedPick(choices, weights, random);
    const prefix = reverse ? source.cells.slice().reverse() : source.cells;
    recipient.cells.unshift(...prefix);
    for (const cell of prefix) owner[key(cell)] = recipient.id;
    source.cells = [];
  }
  const arrows = original.filter(arrow => arrow.cells.length).map((arrow, id) => ({ ...arrow, id }));
  return { size, gridSize, seed, generatorVersion, arrows, solution: arrows.map(arrow => arrow.id) };
}

function shuffled(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Removing a line only deletes blockers, so every legal play order is safe. */
function certifySpecialPuzzle(puzzle) {
  const removed = new Set(), moves = [], records = [];
  for (const arrow of puzzle.arrows) {
    const choices = [routeInfo(puzzle, arrow, false)];
    if (arrow.bidirectional) choices.push(routeInfo(puzzle, arrow, true));
    if (choices.some(info => info.route.loop)) return null;
    records.push({ arrow, choices });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const { arrow, choices } of records) {
      if (removed.has(arrow.id)) continue;
      const choice = choices.findIndex(info => !info.selfBlocked && !info.route.loop
        && [...info.dependencies].every(id => removed.has(id)));
      if (choice < 0) continue;
      removed.add(arrow.id); moves.push({ id: arrow.id, reverse: choice === 1 }); changed = true;
    }
  }
  if (removed.size !== puzzle.arrows.length) return null;
  const edges = new Set(), markers = new Set();
  for (const move of moves) {
    const route = routeInfo(puzzle, indexPuzzle(puzzle).arrows.get(move.id), move.reverse).route;
    for (const transition of route.transitions) edges.add(transition.edge);
    for (const turn of route.turns) markers.add(turn.id);
  }
  return { moves, removed, edges, markers };
}

function finishSpecialPuzzle(puzzle, certificate) {
  return { ...puzzle, solution: certificate.moves.map(move => move.id), solutionMoves: certificate.moves };
}

/** Feature-first carving keeps all routes provable without repeated repair passes. */
function generateSpecialPuzzle(size, seed) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let puzzle = buildFeaturePuzzle(size, seed, seededRandom, attempt);
    const random = seededRandom(String(seed) + ':two-ends:' + attempt);
    const eligible = puzzle.arrows.filter(arrow => {
      const info = routeInfo(puzzle, arrow, true);
      return !info.selfBlocked && !info.route.loop;
    });
    const doubles = new Set(shuffled(eligible, random).slice(0, Math.max(1, Math.round(puzzle.arrows.length * 0.24))).map(arrow => arrow.id));
    puzzle = { ...puzzle, arrows: puzzle.arrows.map(arrow => doubles.has(arrow.id) ? { ...arrow, bidirectional: true } : arrow) };
    const certificate = certifySpecialPuzzle(puzzle);
    if (!certificate) throw new Error('Feature carving produced an uncertified puzzle');
    const result = finishSpecialPuzzle(puzzle, certificate);
    if (certificate.edges.size && certificate.markers.size && doubles.size) return result;
  }
  throw new Error('Could not create a useful mix of surface mechanics for this seed');
}

function indexPuzzle(puzzle) {
  let index = indexes.get(puzzle);
  if (index) return index;
  const cells = new Map();
  const arrows = new Map();
  const gridSize = getGridSize(puzzle);
  for (const arrow of puzzle.arrows) {
    arrows.set(arrow.id, arrow);
    for (const cell of arrow.cells) cells.set(cellKey(cell.face ?? arrow.face, cell.x, cell.y, gridSize), arrow.id);
  }
  index = { cells, arrows, routes: new Map(), special: Boolean(puzzle.wrapEdges?.length || puzzle.redirectors?.length || puzzle.arrows.some(arrow => arrow.bidirectional)) };
  indexes.set(puzzle, index);
  return index;
}

/** Return the first obstructing arrow ID, or null if the exit ray is clear. */
export function getBlockingArrow(puzzle, id, removed = new Set(), reverse = false) {
  const index = indexPuzzle(puzzle);
  if (index.special) return getArrowMove(puzzle, id, removed, reverse)?.blockerId ?? null;
  const arrow = index.arrows.get(id);
  if (!arrow || removed.has(id)) return null;
  const head = arrow.cells.at(-1);
  const gridSize = getGridSize(puzzle);
  let x = head.x + arrow.direction.x;
  let y = head.y + arrow.direction.y;
  while (inside(x, y, gridSize)) {
    const blocker = index.cells.get(cellKey(head.face ?? arrow.face, x, y, gridSize));
    if (blocker !== undefined && !removed.has(blocker)) return blocker;
    x += arrow.direction.x;
    y += arrow.direction.y;
  }
  return null;
}

export function canRemove(puzzle, id, removed = new Set(), reverse) {
  const index = indexPuzzle(puzzle), arrow = index.arrows.get(id);
  if (removed.has(id) || !arrow || (reverse && !arrow.bidirectional)) return false;
  if (!index.special) return getBlockingArrow(puzzle, id, removed) === null;
  if (reverse !== undefined) return Boolean(getArrowMove(puzzle, id, removed, reverse)?.canExit);
  return getArrowMove(puzzle, id, removed, false).canExit
    || Boolean(arrow.bidirectional && getArrowMove(puzzle, id, removed, true).canExit);
}

export function getRemovable(puzzle, removed = new Set()) {
  const result = [];
  for (const arrow of puzzle.arrows) {
    if (removed.has(arrow.id)) continue;
    if (canRemove(puzzle, arrow.id, removed, false)) result.push(arrow);
    else if (arrow.bidirectional && canRemove(puzzle, arrow.id, removed, true)) {
      result.push({ ...orientArrow(arrow, getGridSize(puzzle), true), reverse: true });
    }
  }
  return result;
}

/** Cached routes and swept self-occupancy for both endpoints of a line. */
function routeInfo(puzzle, arrow, reverse) {
  const index = indexPuzzle(puzzle), key = `${arrow.id}:${reverse ? 1 : 0}`;
  if (index.routes.has(key)) return index.routes.get(key);
  const size = getGridSize(puzzle), moving = orientArrow(arrow, size, reverse);
  const route = traceExitRoute(puzzle, arrow, reverse), length = moving.cells.length - 1;
  const trail = new Map(moving.cells.map((cell, i) => [surfaceCellKey({ ...cell, face: cell.face ?? moving.face }, size), i - length]));
  const obstacles = [], dependencies = new Set();
  let selfBlocked = false;
  for (const node of route.nodes.slice(1)) {
    const cell = surfaceCellKey(node, size), lastVisit = trail.get(cell);
    if (lastVisit !== undefined && node.step - lastVisit <= length) {
      obstacles.push({ id: arrow.id, node }); selfBlocked = true; break;
    }
    trail.set(cell, node.step);
    const owner = index.cells.get(cell);
    if (owner !== undefined && owner !== arrow.id) { obstacles.push({ id: owner, node }); dependencies.add(owner); }
  }
  const result = { arrow: moving, route, obstacles, dependencies, selfBlocked };
  index.routes.set(key, result);
  return result;
}

/** A direction-specific move, shared by certification, hints, and animation. */
export function getArrowMove(puzzle, id, removed = new Set(), reverse = false) {
  const index = indexPuzzle(puzzle), arrow = index.arrows.get(id);
  if (!arrow || removed.has(id) || (reverse && !arrow.bidirectional)) return null;
  const info = routeInfo(puzzle, arrow, reverse);
  const obstacle = info.obstacles.find(item => !removed.has(item.id));
  return { ...info, reverse, blockerId: obstacle?.id ?? (info.route.loop ? id : null),
    blockerNode: obstacle?.node ?? null, canExit: !obstacle && !info.route.loop };
}
