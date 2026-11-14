import test from 'node:test';
import assert from 'node:assert/strict';
import { traceExitRoute, cubeEdges, surfaceCellKey } from '../src/routing.js';
import { neighbor, directionBetween } from '../src/cube-surface.js';
import { generatePuzzle, canRemove, getArrowMove, getBlockingArrow, getRemovable } from '../src/engine.js';

const right = { x: 1, y: 0 }, down = { x: 0, y: 1 };
const source = { id: 0, face: 0, direction: right,
  cells: [0, 1, 2].map(x => ({ face: 0, x, y: 1 })) };
const chain = { size: 4, gridSize: 4, wrapEdges: [[0, 1], [1, 5]],
  redirectors: [{ id: 0, face: 1, x: 1, y: 1, direction: down },
    { id: 1, face: 5, x: 2, y: 1, direction: down }], arrows: [source] };

test('one tap follows chained yellow edges and blue redirects until an unmarked edge', () => {
  const route = traceExitRoute(chain, source);
  assert.deepEqual(route.transitions.map(item => item.edge), ['0:1', '1:5']);
  assert.deepEqual(route.turns.map(item => item.id), [0, 1]);
  assert.equal(route.exit.face, 5);
  assert.deepEqual(route.exit.direction, down);
  assert.equal(route.loop, false);
  assert(canRemove(chain, 0));
});

test('all twelve yellow edges work from either face along their full length', () => {
  assert.equal(cubeEdges().length, 12);
  for (const edge of cubeEdges()) for (const face of edge) for (let lane = 0; lane < 5; lane++) {
    let start;
    for (const direction of [right, down, { x: -1, y: 0 }, { x: 0, y: -1 }]) {
      const cell = { face, x: direction.x ? (direction.x < 0 ? 0 : 4) : lane, y: direction.y ? (direction.y < 0 ? 0 : 4) : lane };
      const next = neighbor(cell, direction, 5);
      if (next.cell.face === edge.find(other => other !== face)) start = { cell, direction };
    }
    assert(start);
    const route = traceExitRoute({ size: 5, wrapEdges: [edge] }, { id: 0, face, direction: start.direction, cells: [start.cell] });
    assert.equal(route.transitions[0].from, face);
    assert.equal(route.transitions[0].to, edge.find(other => other !== face));
  }
});

test('a collision after a redirect on a different face blocks that chosen move', () => {
  const blocker = { id: 1, face: 5, direction: right,
    cells: [1, 2, 3].map(x => ({ face: 5, x, y: 3 })) };
  const puzzle = { ...chain, arrows: [source, blocker] };
  assert.equal(getBlockingArrow(puzzle, 0), 1);
  assert.equal(getArrowMove(puzzle, 0).blockerNode.face, 5);
  assert(!canRemove(puzzle, 0, new Set(), false));
  assert(canRemove(puzzle, 0, new Set([1]), false));
});

test('two-ended moves and hints choose the available end instead of the blocked head', () => {
  const blocker = { id: 1, face: 0, direction: down, cells: [0, 1, 2].map(y => ({ face: 0, x: 3, y })) };
  const puzzle = { size: 4, arrows: [{ ...source, bidirectional: true }, blocker] };
  assert(!canRemove(puzzle, 0, new Set(), false));
  assert(canRemove(puzzle, 0, new Set(), true));
  assert(canRemove(puzzle, 0));
  const hint = getRemovable(puzzle).find(arrow => arrow.id === 0);
  assert.equal(hint.reverse, true);
  assert.deepEqual(hint.direction, { x: -1, y: 0 });
});

test('closed routing loops terminate detection and cannot remove a line', () => {
  const puzzle = { size: 4, wrapEdges: [[0, 1], [1, 2], [2, 3], [3, 0]], arrows: [source] };
  const route = traceExitRoute(puzzle, source);
  assert.equal(route.loop, true);
  assert.equal(route.nodes.length, 17);
  assert(!canRemove(puzzle, 0));
});

test('feature boards contain every mechanic, usable reverse ends, and valid certified routes', () => {
  for (const size of [2, 3, 5, 8, 12, 32, 64]) for (let seed = 0; seed < (size >= 32 ? 2 : 12); seed++) {
    const puzzle = generatePuzzle(size, seed), occupied = new Set(), removed = new Set();
    assert.equal(puzzle.generatorVersion, 11);
    assert(puzzle.wrapEdges.length > 0); assert(puzzle.redirectors.length > 0);
    assert(puzzle.arrows.some(arrow => arrow.bidirectional));
    for (const arrow of puzzle.arrows) {
      assert(arrow.cells.length >= 3 && arrow.cells.length <= 75);
      for (let i = 0; i < arrow.cells.length; i++) {
        const cell = arrow.cells[i], key = surfaceCellKey(cell, puzzle.gridSize);
        assert(!occupied.has(key)); occupied.add(key);
        if (i) directionBetween(arrow.cells[i - 1], cell, puzzle.gridSize);
      }
      if (arrow.bidirectional) {
        const reverse = getArrowMove(puzzle, arrow.id, new Set(), true);
        assert(!reverse.route.loop && !reverse.selfBlocked, 'either end must eventually be usable');
      }
    }
    for (const marker of puzzle.redirectors) assert(!occupied.has(surfaceCellKey(marker, puzzle.gridSize)));
    const usedEdges = new Set(), usedMarkers = new Set();
    for (const move of puzzle.solutionMoves) {
      const info = getArrowMove(puzzle, move.id, removed, move.reverse);
      assert(info.canExit, `blocked certificate at ${size}:${seed}:${move.id}`);
      for (const item of info.route.transitions) usedEdges.add(item.edge);
      for (const item of info.route.turns) usedMarkers.add(item.id);
      removed.add(move.id);
    }
    assert.equal(removed.size, puzzle.arrows.length);
    assert(usedEdges.size > 0 && usedMarkers.size > 0, 'the certificate must actually exercise the routing features');
    assert(occupied.size / (6 * puzzle.gridSize ** 2) > 0.8);
  }
});

test('arbitrary legal endpoint choices never deadlock a generated feature board', () => {
  for (let seed = 0; seed < 20; seed++) {
    const puzzle = generatePuzzle(5, seed), removed = new Set();
    while (removed.size < puzzle.arrows.length) {
      const moves = puzzle.arrows.flatMap(arrow => [false, true].filter(reverse => !reverse || arrow.bidirectional)
        .filter(reverse => canRemove(puzzle, arrow.id, removed, reverse)).map(reverse => ({ id: arrow.id, reverse })));
      assert(moves.length > 0);
      removed.add(moves[(seed + removed.size * 7) % moves.length].id);
    }
  }
});
