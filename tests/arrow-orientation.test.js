import test from 'node:test';
import assert from 'node:assert/strict';
import { orientArrow, reverseAtProgress } from '../src/arrow-orientation.js';
import { arrowFragments } from '../src/arrow-motion.js';
import { neighbor } from '../src/cube-surface.js';

test('either end of a wrapped line leads away from its body in its own face coordinates', () => {
  const arrow = { id: 7, face: 1, direction: { x: 1, y: 0 }, bidirectional: true,
    cells: [{ face: 0, x: 6, y: 3 }, { face: 0, x: 7, y: 3 }, { face: 1, x: 0, y: 3 }, { face: 1, x: 1, y: 3 }] };
  const before = JSON.stringify(arrow), reverse = orientArrow(arrow, 8, true);
  assert.equal(orientArrow(arrow, 8), arrow);
  assert.equal(reverse.id, arrow.id);
  assert.equal(reverse.face, 0);
  assert.deepEqual(reverse.direction, { x: -1, y: 0 });
  assert.deepEqual(reverse.cells.at(-1), arrow.cells[0]);
  assert.equal(JSON.stringify(arrow), before, 'orientation must not mutate saved puzzle geometry');
  assert(reverseAtProgress(arrow, 0.9));
  assert(!reverseAtProgress(arrow, 2.1));
  assert(!reverseAtProgress({ ...arrow, bidirectional: false }, 0));
});

test('a tail at a crease uses the neighboring face to determine its reverse direction', () => {
  const first = { face: 0, x: 7, y: 3 }, second = neighbor(first, { x: 1, y: 0 }, 8).cell;
  const arrow = { id: 0, face: 1, direction: { x: 1, y: 0 }, bidirectional: true,
    cells: [first, second, { ...second, x: 1 }] };
  assert.deepEqual(orientArrow(arrow, 8, true).direction, { x: -1, y: 0 });
  const fragments = arrowFragments(arrow, 8);
  assert.deepEqual(fragments[0].progress, [0, 0.5]);
  assert.deepEqual(fragments[1].progress, [0.5, 1, 2]);
});
