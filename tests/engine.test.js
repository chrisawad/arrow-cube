import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePuzzle, canRemove, getRemovable, getBlockingArrow, seededRandom } from '../src/engine.js';

function validateGeometry(puzzle) {
  const cells = new Set();
  const ids = new Set();
  for (const arrow of puzzle.arrows) {
    assert(!ids.has(arrow.id), 'arrow IDs are unique');
    ids.add(arrow.id);
    assert(arrow.face >= 0 && arrow.face < 6);
    assert(arrow.cells.length >= 2);
    for (let i = 0; i < arrow.cells.length; i++) {
      const { x, y } = arrow.cells[i];
      assert(Number.isInteger(x) && Number.isInteger(y));
      assert(x >= 0 && y >= 0 && x < puzzle.size && y < puzzle.size);
      const key = `${arrow.face}/${x}/${y}`;
      assert(!cells.has(key), `overlapping cell ${key}`);
      cells.add(key);
      if (i) assert.equal(Math.abs(x - arrow.cells[i - 1].x) + Math.abs(y - arrow.cells[i - 1].y), 1);
    }
    const head = arrow.cells.at(-1);
    const neck = arrow.cells.at(-2);
    assert.deepEqual(arrow.direction, { x: head.x - neck.x, y: head.y - neck.y });
  }
  assert.equal(new Set(puzzle.solution).size, puzzle.arrows.length);
  assert.equal(puzzle.solution.length, puzzle.arrows.length);
  const removed = new Set();
  for (const id of puzzle.solution) {
    assert(canRemove(puzzle, id, removed), `certified solution blocked at arrow ${id}`);
    removed.add(id);
    assert(!canRemove(puzzle, id, removed), 'removed arrows cannot be played again');
  }
  assert.equal(getRemovable(puzzle, removed).length, 0);
  return cells.size / (6 * puzzle.size * puzzle.size);
}

test('same dimensions and seed reproduce exactly the same puzzle', () => {
  assert.deepEqual(generatePuzzle(8, 'saved-game-42'), generatePuzzle(8, 'saved-game-42'));
  assert.notDeepEqual(generatePuzzle(8, 'saved-game-42'), generatePuzzle(8, 'saved-game-43'));
});

test('all generated geometry and certified solutions are valid across levels and seeds', () => {
  let minimumCoverage = 1;
  for (const size of [2, 3, 4, 5, 7, 10, 16, 24, 32, 40, 64]) {
    for (let seed = 0; seed < (size < 16 ? 32 : 6); seed++) {
      const coverage = validateGeometry(generatePuzzle(size, seed));
      minimumCoverage = Math.min(minimumCoverage, coverage);
      assert(coverage >= 0.7, `size ${size}, seed ${seed}: insufficient coverage ${coverage}`);
    }
  }
  console.log(`Lowest tested face-average coverage: ${(minimumCoverage * 100).toFixed(1)}%`);
});

test('arbitrary legal play orders never produce a deadlock', () => {
  for (let seed = 0; seed < 24; seed++) {
    const puzzle = generatePuzzle(10, seed);
    const random = seededRandom(`play-${seed}`);
    const removed = new Set();
    while (removed.size < puzzle.arrows.length) {
      const legal = getRemovable(puzzle, removed);
      assert(legal.length > 0, `deadlock after ${removed.size} moves`);
      const choice = legal[Math.floor(random() * legal.length)];
      removed.add(choice.id);
    }
  }
});

test('boards have meaningful dependencies, bends, and different lengths', () => {
  for (let seed = 0; seed < 16; seed++) {
    const puzzle = generatePuzzle(9, seed);
    const lengths = new Set(puzzle.arrows.map(arrow => arrow.cells.length));
    const directions = new Set(puzzle.arrows.map(arrow => `${arrow.direction.x},${arrow.direction.y}`));
    assert(lengths.size >= 5);
    assert.equal(directions.size, 4);
    const bent = puzzle.arrows.filter(arrow => arrow.cells.some((cell, i, path) => i >= 2 &&
      (cell.x - path[i - 1].x !== path[i - 1].x - path[i - 2].x || cell.y - path[i - 1].y !== path[i - 1].y - path[i - 2].y)));
    assert(bent.length > puzzle.arrows.length * 0.3);
    assert(getRemovable(puzzle).length < puzzle.arrows.length * 0.8);
  }
});

test('blockers are identified and removed arrows clear the exit ray', () => {
  const puzzle = {
    size: 5,
    arrows: [
      { id: 0, face: 0, cells: [{ x: 0, y: 2 }, { x: 1, y: 2 }], direction: { x: 1, y: 0 } },
      { id: 1, face: 0, cells: [{ x: 3, y: 2 }, { x: 4, y: 2 }], direction: { x: 1, y: 0 } },
      { id: 2, face: 1, cells: [{ x: 0, y: 2 }, { x: 1, y: 2 }], direction: { x: 1, y: 0 } },
    ],
  };
  const before = JSON.stringify(puzzle);
  assert.equal(getBlockingArrow(puzzle, 0), 1);
  assert(!canRemove(puzzle, 0));
  assert(canRemove(puzzle, 1));
  assert(canRemove(puzzle, 2), 'other faces are independent');
  assert(canRemove(puzzle, 0, new Set([1])));
  assert(!canRemove(puzzle, 'missing'));
  assert.equal(JSON.stringify(puzzle), before, 'move queries do not mutate the board');
});

test('invalid dimensions are rejected instead of hanging or allocating huge grids', () => {
  for (const size of [0, 1, -1, 2.5, NaN, Infinity, 65, '4']) assert.throws(() => generatePuzzle(size, 1), RangeError);
});
