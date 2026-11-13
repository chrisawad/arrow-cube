import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ARROW_SHAPE, arrowShape, arrowFragments, findArrowCollision, bumpTimings, sampleBumpMotion } from '../src/arrow-motion.js';
import { CubeView, surfaceTrack, sampleSurfaceTrack } from '../src/cube-view.js';

const arrow = (id, cells, direction, face = 0) => ({ id, face, cells: cells.map(([x, y]) => ({ x, y })), direction });
const right = { x: 1, y: 0 }, down = { x: 0, y: 1 };
const source = arrow(0, [[0, 2], [1, 2]], right);
const crossing = arrow(1, [[3, 1], [3, 2], [3, 3]], down);
const puzzle = { size: 8, arrows: [source, crossing] };
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('stops the moving tip against the rendered stroke, in all four directions', () => {
  for (let rotation = 0; rotation < 4; rotation++) {
    const rotate = ({ x, y }) => rotation === 0 ? { x, y } : rotation === 1 ? { x: -y, y: x }
      : rotation === 2 ? { x: -x, y: -y } : { x: y, y: -x };
    const arrows = puzzle.arrows.map(a => ({ ...a, direction: rotate(a.direction),
      cells: a.cells.map(p => { const v = rotate(p); return { x: v.x + 4, y: v.y + 4 }; }) }));
    close(findArrowCollision({ size: 10, arrows }, arrows[0]).distance, 2 - 0.32 - 0.095);
  }
});

test('opposing arrowheads touch before either center reaches the obstacle', () => {
  const opposing = arrow('opposing', [[4, 2], [3, 2]], { x: -1, y: 0 });
  close(findArrowCollision({ size: 8, arrows: [source, opposing] }, source).distance, 2 - 0.32 * 2);
});

test('singleton stems stay inside their cell and stop approaching arrows at their rounded tail', () => {
  assert(ARROW_SHAPE.singletonStem + ARROW_SHAPE.radius <= 0.5);
  assert(ARROW_SHAPE.tip <= 0.5 && ARROW_SHAPE.wing <= 0.5);
  const singleton = arrow('single', [[3, 2]], right);
  close(findArrowCollision({ size: 8, arrows: [source, singleton] }, source).distance,
    2 - ARROW_SHAPE.singletonStem - ARROW_SHAPE.radius - ARROW_SHAPE.tip);
  const incoming = arrow('incoming', [[1, 2]], right);
  close(findArrowCollision({ size: 8, arrows: [incoming, singleton] }, incoming).distance,
    2 - ARROW_SHAPE.singletonStem - ARROW_SHAPE.radius - ARROW_SHAPE.tip);
});

test('uses the nearest live obstacle, ignores other faces, and preserves occupancy', () => {
  const far = arrow('far', [[6, 1], [6, 2], [6, 3]], down);
  const otherFace = arrow('other', [[2, 1], [2, 2]], down, 1);
  const p = { size: 8, arrows: [source, crossing, far, otherFace] }, removed = new Set([1]);
  assert.equal(findArrowCollision(p, source).blockerId, 1);
  const contact = findArrowCollision(p, source, removed);
  assert.equal(contact.blockerId, 'far');
  close(contact.distance, 5 - 0.32 - 0.095);
  assert.deepEqual([...removed], [1]);
  assert.equal(findArrowCollision(p, source, new Set([1, 'far'])), null);
});

test('recognizes a self-blocking loop without colliding with its own original head', () => {
  const loop = arrow('loop', [[3, 2], [3, 1], [2, 1], [1, 1], [0, 1], [0, 2], [1, 2]], right);
  const contact = findArrowCollision({ size: 8, arrows: [loop] }, loop);
  assert.equal(contact.blockerId, 'loop');
  close(contact.distance, 2 - 0.32 - 0.095);
});

test('black outbound reaches contact before red, then makes a quicker red return', () => {
  const timings = bumpTimings(4);
  assert(timings.rollback < timings.outbound);
  const before = sampleBumpMotion(timings.outbound - 1, 4, timings);
  assert.equal(before.color, 'ink'); assert.equal(before.impacted, false); assert(before.distance < 4);
  const impact = sampleBumpMotion(timings.outbound, 4, timings);
  assert.equal(impact.color, 'blocked'); assert.equal(impact.impacted, true); assert.equal(impact.distance, 4);
  const halfway = sampleBumpMotion(timings.outbound + timings.hold + timings.rollback / 2, 4, timings);
  assert.equal(halfway.color, 'blocked'); assert(halfway.distance > 0 && halfway.distance < 4);
  const end = sampleBumpMotion(timings.outbound + timings.hold + timings.rollback, 4, timings);
  assert.deepEqual(end, { distance: 0, impacted: true, complete: true, color: 'blocked' });
  assert.equal(sampleBumpMotion(0, 4, timings, false, true).color, 'blocked');
});

test('reduced motion provides stationary impact feedback', () => {
  const timings = bumpTimings(4, true);
  for (const elapsed of [0, 79, 80, 150, 230]) {
    assert.equal(sampleBumpMotion(elapsed, 4, timings, true).distance, 0);
  }
  assert.equal(sampleBumpMotion(79, 4, timings, true).color, 'ink');
  assert.equal(sampleBumpMotion(80, 4, timings, true).color, 'blocked');
});

// Exercise the real renderer lifecycle with Three.js geometry and a stub drawing
// surface. No browser/WebGL harness is needed to verify callbacks and cleanup.
function viewFixture(board = puzzle) {
  const view = Object.create(CubeView.prototype);
  Object.assign(view, { puzzle: board, arrowById: new Map(board.arrows.map(a => [a.id, a])), removed: new Set(), blocked: new Set(),
    animations: new Map(), pointers: new Map(), velocity: { x: 0, y: 0 }, reducedMotion: false,
    cube: new THREE.Group(), faces: [{ plane: new THREE.Mesh() }],
    renderer: { render() {} }, drawFaces() {}, schedule() {} });
  return view;
}

test('renderer invokes impact once and restores the arrow without removing it', async () => {
  const view = viewFixture(); let impacts = 0;
  const result = view.bumpArrow(0, { onImpact: () => { assert(view.blocked.has(0)); impacts++; } });
  assert.equal(view.bumpArrow(0), result);
  const animation = view.animations.get(0);
  // Integer timestamps keep exact boundary checks independent of clock rounding.
  const start = animation.start = 1000;
  view.frame(start + animation.timings.outbound - 1);
  assert.equal(impacts, 0); assert.equal(animation.material.color.getHexString(), '15191f');
  view.frame(start + animation.timings.outbound);
  assert.equal(impacts, 1); assert.equal(animation.material.color.getHexString(), 'e16457');
  view.frame(start + animation.timings.outbound + 10);
  assert.equal(impacts, 1);
  view.frame(start + animation.timings.outbound + animation.timings.hold + animation.timings.rollback);
  assert.equal(await result, true); assert.equal(impacts, 1);
  assert(view.blocked.has(0));
  assert.equal(view.removed.size, 0); assert.equal(view.animations.size, 0); assert.equal(view.cube.children.length, 0);
});

test('full motion overrides a reduced-motion device and visibly moves through impact and rollback', async () => {
  const view = viewFixture();
  view.motionPreference = { matches: true };
  view.setMotionMode('auto');
  assert.equal(view.reducedMotion, true);
  view.setMotionMode('full');
  const done = view.bumpArrow(0), animation = view.animations.get(0);
  animation.start = 1000;
  const atRest = Array.from(animation.mesh.geometry.attributes.position.array);
  view.frame(1000 + animation.timings.outbound / 2);
  assert.notDeepEqual(Array.from(animation.mesh.geometry.attributes.position.array), atRest);
  assert.equal(animation.material.color.getHexString(), '15191f');
  view.frame(1000 + animation.timings.outbound);
  const atImpact = Array.from(animation.mesh.geometry.attributes.position.array);
  assert.equal(animation.material.color.getHexString(), 'e16457');
  view.frame(1000 + animation.timings.outbound + animation.timings.hold + animation.timings.rollback / 2);
  assert.notDeepEqual(Array.from(animation.mesh.geometry.attributes.position.array), atImpact);
  view.frame(1000 + animation.timings.outbound + animation.timings.hold + animation.timings.rollback);
  assert.equal(await done, true);
  assert(view.blocked.has(0));
  assert.equal(view.removed.size, 0);
});

const wrapped = { id: 'wrapped', face: 1, direction: right,
  cells: [{ face: 0, x: 6, y: 3 }, { face: 0, x: 7, y: 3 }, { face: 1, x: 0, y: 3 }, { face: 1, x: 1, y: 3 }] };
const wrappedBoard = { size: 4, gridSize: 8, generatorVersion: 3, arrows: [wrapped] };

test('wrapped fragments join at both face edges and have exactly one head', () => {
  const fragments = arrowFragments(wrapped, 8);
  assert.equal(fragments.length, 2);
  assert.deepEqual(fragments[0].points.at(-1), { x: 7.5, y: 3 });
  assert.deepEqual(fragments[1].points[0], { x: -0.5, y: 3 });
  assert.deepEqual(fragments.map(f => f.head), [false, true]);
  const shape = arrowShape(wrappedBoard);
  assert.equal(shape.radius, 0.23688);
  assert(shape.radius + shape.singletonStem <= 0.5);
});

test('wrapped motion follows the surface crease then exits straight from the head face', () => {
  const track = surfaceTrack(wrapped, wrappedBoard);
  const seam = track.nodes.filter(node => node.s === 1.5);
  assert.equal(seam.length, 2); assert(seam[0].point.equals(seam[1].point));
  close(seam[0].point.x, 1.024); close(seam[0].point.z, 1.024);
  const before = sampleSurfaceTrack(track, 1.4), after = sampleSurfaceTrack(track, 1.6);
  close(before.point.z, 1.024); close(after.point.x, 1.024);
  assert(before.point.x < 1.024 && after.point.z < 1.024);
  const head = sampleSurfaceTrack(track, track.head), flown = sampleSurfaceTrack(track, track.head + 4);
  close(flown.point.x, head.point.x); close(flown.point.y, head.point.y);
  close(flown.point.z, head.point.z - track.unit * 4);
});

test('collision with a wrapped strand ignores that arrow head on another face', () => {
  const incoming = { ...arrow('incoming', [[4, 2], [5, 2]], right), cells: [{ face: 0, x: 4, y: 2 }, { face: 0, x: 5, y: 2 }] };
  const blocker = { id: 'blocker', face: 1, direction: right,
    cells: [{ face: 0, x: 7, y: 1 }, { face: 0, x: 7, y: 2 }, ...Array.from({ length: 7 }, (_, x) => ({ face: 1, x, y: 2 }))] };
  const board = { ...wrappedBoard, arrows: [incoming, blocker] };
  const collision = findArrowCollision(board, incoming);
  assert.equal(collision.blockerId, 'blocker');
  close(collision.distance, 2 - 0.44 - 0.23688);
});

test('thicker dense heads retain a visible gap from adjacent arrows in every orientation', () => {
  for (const direction of [right, down, { x: -1, y: 0 }, { x: 0, y: -1 }]) {
    const blocker = arrow('adjacent', [[2, 2]], direction);
    const board = { size: 2, gridSize: 4, generatorVersion: 6, arrows: [source, blocker] };
    const collision = findArrowCollision(board, source);
    assert(collision.distance >= 0.069999, `adjacent arrow starts touching: ${JSON.stringify(direction)}`);
  }
  const forward = { size: 2, gridSize: 4, generatorVersion: 6, arrows: [source, arrow('forward', [[2, 2]], right)] };
  close(findArrowCollision(forward, source).distance, 0.07312);
  assert.deepEqual(arrowShape({ generatorVersion: 1 }), ARROW_SHAPE);
  assert.deepEqual(arrowShape({ generatorVersion: 2 }), ARROW_SHAPE);
  assert.deepEqual(arrowShape({ generatorVersion: 3 }), arrowShape({ generatorVersion: 6 }));
});

test('wrapped removal hides every occupied face and cancellation restores both', async () => {
  const view = viewFixture(wrappedBoard), faces = [];
  view.drawFaces = face => faces.push(face);
  const result = view.removeArrow('wrapped');
  assert.deepEqual(faces, [0, 1]);
  const animation = view.animations.get('wrapped');
  assert(animation.duration <= 520);
  assert.equal(animation.mesh.geometry.attributes.position.count, animation.mesh.geometry.attributes.normal.count);
  view.cancelAnimations();
  assert.equal(await result, false);
  assert.deepEqual(faces, [0, 1, 0, 1]);
  assert.equal(view.removed.size, 0);
});

test('full-motion wrapped arrows travel visibly before disappearing on a reduced-motion device', async () => {
  const view = viewFixture(wrappedBoard);
  view.motionPreference = { matches: true };
  view.setMotionMode('full');
  const done = view.removeArrow('wrapped'), animation = view.animations.get('wrapped');
  animation.start = 1000;
  const atRest = Array.from(animation.mesh.geometry.attributes.position.array);
  view.frame(1000 + animation.duration / 3);
  assert.notDeepEqual(Array.from(animation.mesh.geometry.attributes.position.array), atRest);
  assert.equal(animation.material.uniforms.opacity.value, 1, 'the arrow remains solid while still on the cube');
  assert.equal(view.removed.size, 0);
  view.frame(1000 + animation.duration);
  assert.equal(await done, true);
  assert(view.removed.has('wrapped'));
  view.setMotionMode('auto');
  assert.equal(view.reducedMotion, true, 'following the device still honors reduced motion');
});

test('picking a wrapped tail fragment selects its shared arrow id', () => {
  const view = viewFixture(wrappedBoard);
  view.fragmentsById = new Map([['wrapped', arrowFragments(wrapped, 8)]]);
  view.arrowsByFace = [[wrapped], [wrapped], [], [], [], []];
  view.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
  view.raycaster = { setFromCamera() {}, intersectObjects: () => [{ uv: { x: 6.5 / 8, y: 1 - 3.5 / 8 }, object: { userData: { face: 0 } } }] };
  assert.equal(view.pick(50, 50), 'wrapped');
});

test('the wider dense arrowhead wing remains clickable', () => {
  const view = viewFixture(wrappedBoard), shape = arrowShape(wrappedBoard);
  view.fragmentsById = new Map([['wrapped', arrowFragments(wrapped, 8)]]);
  view.arrowsByFace = [[wrapped], [wrapped], [], [], [], []];
  view.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
  view.raycaster = { setFromCamera() {}, intersectObjects: () => [{
    uv: { x: (1 - shape.base + 0.5) / 8, y: 1 - (3 + shape.wing + 0.5) / 8 }, object: { userData: { face: 1 } },
  }] };
  assert.equal(view.pick(50, 50), 'wrapped');
});

test('cancelling before impact resolves false, disposes mesh, and leaves the board intact', async () => {
  const view = viewFixture(); let impacts = 0, disposed = 0;
  const result = view.bumpArrow(0, { onImpact: () => impacts++ });
  const animation = view.animations.get(0);
  animation.mesh.geometry.addEventListener('dispose', () => disposed++);
  animation.material.addEventListener('dispose', () => disposed++);
  view.cancelAnimations();
  view.frame(animation.start + 1000);
  assert.equal(await result, false); assert.equal(impacts, 0); assert.equal(disposed, 2);
  assert.equal(view.blocked.size, 0);
  assert.equal(view.removed.size, 0); assert.equal(view.animations.size, 0); assert.equal(view.cube.children.length, 0);
});

function drawingFixture() {
  const view = viewFixture(), strokes = [];
  view.updateCamera = () => {};
  view.faces = Array.from({ length: 6 }, () => {
    const canvas = { width: 768, height: 768 }, texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    const ctx = { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
      stroke() { strokes.push(this.strokeStyle); } };
    return { canvas, ctx, texture, material: { map: texture }, ghostMaterial: { uniforms: { arrows: { value: texture } } } };
  });
  view.drawFaces = CubeView.prototype.drawFaces;
  return { view, strokes };
}

test('persistent crash color survives hints, repeated attempts, and removal until board reset', async () => {
  const { view, strokes } = drawingFixture();
  view.setPuzzle(puzzle);
  const bump = view.bumpArrow(0), animation = view.animations.get(0);
  animation.start = 1000;
  view.frame(animation.start + animation.timings.outbound);
  strokes.length = 0;
  view.frame(animation.start + animation.timings.outbound + animation.timings.hold + animation.timings.rollback);
  assert.equal(await bump, true); assert.equal(strokes[0], '#e16457');
  strokes.length = 0; view.highlight(0); assert.equal(strokes[0], '#5b55e7');
  strokes.length = 0; view.clearHighlight(); assert.equal(strokes[0], '#e16457');
  const again = view.bumpArrow(0);
  assert.equal(view.animations.get(0).material.color.getHexString(), 'e16457');
  view.cancelAnimations(); assert.equal(await again, false); assert(view.blocked.has(0));
  const removal = view.removeArrow(0);
  assert.equal(view.animations.get(0).material.color.getHexString(), 'e16457');
  view.cancelAnimations(); assert.equal(await removal, false);
  const restored = new Set([0]);
  view.setPuzzle(puzzle, new Set(), restored); restored.clear(); assert(view.blocked.has(0));
  strokes.length = 0; view.setPuzzle(puzzle);
  assert.equal(view.blocked.size, 0); assert.equal(strokes[0], '#15191f');
});

test('switching boards cancels pending impact and does not carry red state into the new puzzle', async () => {
  const { view } = drawingFixture();
  view.setPuzzle(puzzle);
  let impacts = 0;
  const pending = view.bumpArrow(0, { onImpact: () => impacts++ });
  const animation = view.animations.get(0);
  view.setPuzzle({ ...puzzle, seed: 'different-board' });
  view.frame(animation.start + 1000);
  assert.equal(await pending, false); assert.equal(impacts, 0); assert.equal(view.blocked.size, 0);
});

test('changing grid resolution replaces uploaded face textures and rebinds both visible and ghost faces', () => {
  const { view } = drawingFixture();
  view.setPuzzle({ ...puzzle, size: 6, gridSize: 10, generatorVersion: 6 });
  let previous = view.faces.map(face => face.texture), disposed = 0;
  for (const texture of previous) texture.addEventListener('dispose', () => disposed++);
  for (const [size, gridSize, resolution] of [[8, 13, 832], [12, 19, 1216], [3, 5, 768]]) {
    view.setPuzzle({ ...puzzle, size, gridSize, generatorVersion: 6 });
    view.faces.forEach((face, index) => {
      assert.notEqual(face.texture, previous[index]);
      assert.equal(face.texture.image.width, resolution); assert.equal(face.texture.image.height, resolution);
      assert.equal(face.material.map, face.texture); assert.equal(face.ghostMaterial.uniforms.arrows.value, face.texture);
      assert.equal(face.texture.colorSpace, THREE.SRGBColorSpace); assert.equal(face.texture.anisotropy, 4);
    });
    previous = view.faces.map(face => face.texture);
  }
  assert.equal(disposed, 6);
  view.setPuzzle({ ...puzzle, size: 4, gridSize: 6, generatorVersion: 6 });
  view.faces.forEach((face, index) => assert.equal(face.texture, previous[index], 'same-sized allocations are reused'));
});
