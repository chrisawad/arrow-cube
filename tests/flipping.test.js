import test from 'node:test';
import assert from 'node:assert/strict';
import { traceExitRoute, applyRedirectorFlips, redirectorDirection, flippedRedirectorIds, restoreRedirectors } from '../src/routing.js';
import { getArrowMove, getRemovable, generatePuzzle, seededRandom } from '../src/engine.js';

const right = { x: 1, y: 0 }, left = { x: -1, y: 0 }, down = { x: 0, y: 1 }, up = { x: 0, y: -1 };
const arrow = { id: 0, face: 0, direction: right, cells: [0, 1, 2].map(x => ({ face: 0, x, y: 3 })) };
const fixture = () => ({ size: 7, gridSize: 7, generatorVersion: 13, wrapEdges: [],
  redirectors: [{ id: 9, face: 0, x: 3, y: 3, direction: down, flipping: true, flipped: false }],
  arrows: [arrow, { id: 1, face: 0, direction: left, cells: [6, 5, 4].map(x => ({ face: 0, x, y: 3 })) }] });

test('purple redirects use the current direction, flip once per passing line, and invalidate hint routes', () => {
  const puzzle = fixture(), before = structuredClone(puzzle), removed = new Set();
  assert.equal(getRemovable(puzzle).length, 2);
  const first = getArrowMove(puzzle, 0, removed);
  assert.deepEqual(first.route.exit.direction, down);
  assert.deepEqual(puzzle, before, 'previewing moves and hints must not flip markers');
  applyRedirectorFlips(puzzle, first.route); removed.add(0);
  assert.deepEqual(redirectorDirection(puzzle.redirectors[0]), up);
  const second = getArrowMove(puzzle, 1, removed);
  assert.deepEqual(second.route.exit.direction, up, 'cached routes must follow the new direction');
  applyRedirectorFlips(puzzle, second.route);
  assert.deepEqual(flippedRedirectorIds(puzzle), []);
});

test('a second visit in one move uses the flipped direction instead of falsely detecting a loop', () => {
  const puzzle = fixture(); puzzle.arrows = [arrow];
  puzzle.redirectors.push({ id: 10, face: 0, x: 3, y: 5, direction: right },
    { id: 11, face: 0, x: 5, y: 5, direction: up }, { id: 12, face: 0, x: 5, y: 3, direction: left });
  const route = traceExitRoute(puzzle, arrow);
  assert.equal(route.loop, false);
  assert.deepEqual(route.flips.map(event => [event.at, event.flipped]), [[1, true], [9, false]]);
  assert.deepEqual(route.exit.direction, up);
  assert(getArrowMove(puzzle, 0).canExit);
  applyRedirectorFlips(puzzle, route);
  assert.equal(puzzle.redirectors[0].flipped, false);
});

test('passing straight through a purple marker still flips it, while blue remains fixed', () => {
  const puzzle = fixture(); puzzle.arrows = [arrow];
  puzzle.redirectors[0].direction = right;
  puzzle.redirectors.push({ id: 10, face: 0, x: 5, y: 3, direction: down });
  const route = traceExitRoute(puzzle, arrow);
  assert.deepEqual(route.flips.map(event => event.id), [9]);
  assert.deepEqual(route.turns.map(event => event.id), [10]);
  applyRedirectorFlips(puzzle, route);
  assert.deepEqual(redirectorDirection(puzzle.redirectors[0]), left);
  assert.deepEqual(puzzle.redirectors[1].direction, down);
});

test('restoring filters stale IDs and restart restores original orientations', () => {
  const puzzle = fixture();
  restoreRedirectors(puzzle, [9, 999]);
  assert.deepEqual(flippedRedirectorIds(puzzle), [9]);
  assert.deepEqual(getArrowMove(puzzle, 0).route.exit.direction, up);
  restoreRedirectors(puzzle);
  assert.deepEqual(getArrowMove(puzzle, 0).route.exit.direction, down);
});

test('generated boards can finish from every purple state and arbitrary legal endpoint orders', () => {
  for (const size of [2, 3, 5, 8, 12]) for (let seed = 0; seed < 16; seed++) {
    const original = generatePuzzle(size, seed), switches = original.redirectors.filter(marker => marker.flipping);
    assert(switches.length >= 1 && switches.length <= 2);
    for (let mask = 0; mask < 2 ** switches.length; mask++) {
      const puzzle = structuredClone(original), removed = new Set(), random = seededRandom(`${size}:${seed}:${mask}`);
      restoreRedirectors(puzzle, switches.filter((_, i) => mask & (1 << i)).map(marker => marker.id));
      while (removed.size < puzzle.arrows.length) {
        const legal = puzzle.arrows.flatMap(arrow => (arrow.bidirectional ? [false, true] : [false])
          .map(reverse => getArrowMove(puzzle, arrow.id, removed, reverse)).filter(info => info?.canExit));
        assert(legal.length, `deadlock: ${size}/${seed}, state ${mask}, removed ${removed.size}`);
        const chosen = legal[Math.floor(random() * legal.length)];
        applyRedirectorFlips(puzzle, chosen.route); removed.add(chosen.arrow.id);
      }
    }
  }
});
