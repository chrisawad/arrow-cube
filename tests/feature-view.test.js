import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CubeView, surfaceTrack, sampleSurfaceTrack } from '../src/cube-view.js';
import { traceExitRoute, cubeEdges } from '../src/routing.js';
import { yellowEdgeGeometries } from '../src/yellow-edges.js';
import { cellToWorld } from '../src/cube-surface.js';
import { arrowFragments, findArrowCollision } from '../src/arrow-motion.js';

const right = { x: 1, y: 0 }, down = { x: 0, y: 1 };
const source = { id: 0, face: 0, direction: right,
  cells: [0, 1, 2].map(x => ({ face: 0, x, y: 1 })) };
const chain = { size: 4, gridSize: 4, generatorVersion: 11, wrapEdges: [[0, 1], [1, 5]],
  redirectors: [{ id: 0, face: 1, x: 1, y: 1, direction: down },
    { id: 1, face: 5, x: 2, y: 1, direction: down }], arrows: [source] };

function fixture(puzzle = chain) {
  const view = Object.create(CubeView.prototype), strokes = [], fills = [];
  const faces = Array.from({ length: 6 }, () => {
    const canvas = { width: 768, height: 768 }, texture = new THREE.CanvasTexture(canvas);
    const ctx = { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      createLinearGradient() { return { addColorStop() {} }; },
      stroke() { strokes.push(this.strokeStyle); }, fill() { fills.push(this.fillStyle); } };
    return { canvas, texture, ctx, plane: new THREE.Mesh(), material: { map: texture }, ghostMaterial: { uniforms: { arrows: { value: texture } } } };
  });
  Object.assign(view, { removed: new Set(), blocked: new Set(), animations: new Map(), pointers: new Map(), velocity: { x: 0, y: 0 },
    reducedMotion: false, cube: new THREE.Group(), faces, renderer: { render() {} }, schedule() {}, updateCamera() {} });
  view.setPuzzle(puzzle);
  return { view, strokes, fills };
}

const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('yellow bands and rounded caps never protrude beyond the arrow planes in face-on views', () => {
  // Exercise isolated caps, joined corners, and three-way junctions on all
  // physical edges; render order alone cannot fix a protruding yellow lip.
  const edges = cubeEdges();
  for (const selection of [...edges.map(edge => [edge]), [[0, 1], [0, 4]], edges]) {
    for (const geometry of yellowEdgeGeometries(selection)) {
      const positions = geometry.attributes.position.array;
      assert([...positions].every(Number.isFinite));
      for (const coordinate of positions) assert(Math.abs(coordinate) < 1.021,
        'yellow geometry must stay below the static arrow plane, even at a cap or join');
      geometry.dispose();
    }
  }
});

test('the movement track turns on both blue markers and follows both physical creases', () => {
  const route = traceExitRoute(chain, source), track = surfaceTrack(source, chain, route);
  for (const node of route.nodes) {
    const actual = sampleSurfaceTrack(track, track.head + node.step), expected = cellToWorld(node, 4);
    close(actual.point.x, expected.x * 1.024); close(actual.point.y, expected.y * 1.024); close(actual.point.z, expected.z * 1.024);
  }
  for (const transition of route.transitions) {
    const seam = track.nodes.filter(node => node.s === track.head + transition.at);
    assert.equal(seam.length, 2); assert(seam[0].point.equals(seam[1].point));
    assert(!seam[0].normal.equals(seam[1].normal));
  }
  const onRight = sampleSurfaceTrack(track, track.head + 3.25);
  close(onRight.direction.x, 0); close(onRight.direction.y, -1); close(onRight.direction.z, 0);
  const onBottom = sampleSurfaceTrack(track, track.head + 7.25);
  close(onBottom.direction.x, 0); close(onBottom.direction.y, 0); close(onBottom.direction.z, -1);
});

test('routed departure remains solid through transitions, bends its head on the surface, then exits', async () => {
  const { view, strokes } = fixture(), done = view.removeArrow(0), animation = view.animations.get(0);
  animation.start = 1000;
  assert.equal(animation.route.turns.length, 2);
  for (const distance of [1.35, 1.5, 3.2, 5.45, 7.2, animation.route.distance + 0.5]) {
    view.frame(1000 + Math.sqrt(distance / animation.travel) * animation.duration);
    assert.equal(animation.material.uniforms.opacity.value, 1, 'on-cube portions cannot fade away');
    const positions = animation.mesh.geometry.attributes.position.array;
    assert([...positions].every(Number.isFinite));
    for (let i = 0; i < positions.length; i += 3) {
      assert(Math.max(Math.abs(positions[i]), Math.abs(positions[i + 1]), Math.abs(positions[i + 2])) >= 1.02399, 'ribbon or arrowhead cut through the cube interior');
    }
  }
  view.frame(1000 + animation.duration);
  assert.equal(await done, true); assert(view.removed.has(0));
  assert.equal(view.featureEdges.children.length, 2);
  view.drawFaces(); assert(strokes.includes('#74ccef'), 'fixed redirectors remain after a line leaves');
});

test('a chained collision reaches contact, ticks once, and rolls back red along the same route', async () => {
  const blocker = { id: 1, face: 5, direction: right, cells: [1, 2, 3].map(x => ({ face: 5, x, y: 3 })) };
  const puzzle = { ...chain, arrows: [source, blocker] }, { view } = fixture(puzzle);
  let impacts = 0;
  const done = view.bumpArrow(0, { onImpact() { impacts++; } }), animation = view.animations.get(0);
  animation.start = 1000;
  assert(animation.distance > 7, 'collision must occur after both redirects and edge crossings');
  const collision = findArrowCollision(puzzle, source);
  close(animation.distance, collision.distance);
  view.frame(1000 + animation.timings.outbound - 1);
  assert.equal(impacts, 0); assert.equal(animation.material.color.getHexString(), '15191f');
  view.frame(1000 + animation.timings.outbound);
  assert.equal(impacts, 1); assert.equal(animation.material.color.getHexString(), 'e16457');
  view.frame(1000 + animation.timings.outbound + animation.timings.hold + animation.timings.rollback / 2);
  assert(animation.lastDistance > 0 && animation.lastDistance < collision.distance);
  view.frame(1000 + animation.timings.outbound + animation.timings.hold + animation.timings.rollback);
  assert.equal(await done, true); assert.equal(impacts, 1);
  assert(view.blocked.has(0)); assert.equal(view.removed.size, 0);
});

test('the two clickable halves keep their endpoint choices across face boundaries', () => {
  const arrow = { id: 0, face: 1, direction: right, bidirectional: true,
    cells: [{ face: 0, x: 6, y: 3 }, { face: 0, x: 7, y: 3 }, { face: 1, x: 0, y: 3 }, { face: 1, x: 1, y: 3 }] };
  const { view, fills } = fixture({ size: 5, gridSize: 8, generatorVersion: 11, arrows: [arrow] });
  view.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
  let hit;
  view.raycaster = { setFromCamera() {}, intersectObjects: () => [hit] };
  hit = { uv: { x: 6.8 / 8, y: 1 - 3.5 / 8 }, object: { userData: { face: 0 } } };
  assert.deepEqual(view.pickMove(50, 50), { id: 0, reverse: true });
  hit = { uv: { x: 1 / 8, y: 1 - 3.5 / 8 }, object: { userData: { face: 1 } } };
  assert.deepEqual(view.pickMove(50, 50), { id: 0, reverse: false });
  assert(fills.includes('#37b487') && fills.includes('#f1c643'), 'both endpoint heads are drawn');
  assert.equal(arrowFragments(arrow, 8).filter(fragment => fragment.head).length, 1, 'the extra tail head is rendered without duplicating the leading endpoint');
});

test('reverse departures lead with the green head and preserve both-end gradient data', async () => {
  const arrow = { ...source, bidirectional: true }, { view } = fixture({ size: 4, gridSize: 4, generatorVersion: 11, arrows: [arrow] });
  const done = view.removeArrow(0, { reverse: true }), animation = view.animations.get(0);
  assert.deepEqual(animation.arrow.cells.at(-1), source.cells[0]);
  assert.deepEqual(animation.arrow.direction, { x: -1, y: 0 });
  assert.equal(animation.material.uniforms.headInk.value.getHexString(), '37b487');
  assert.equal(animation.material.uniforms.tailInk.value.getHexString(), 'f1c643');
  const attribute = animation.mesh.geometry.attributes.pathProgress;
  assert.equal(attribute.count, animation.mesh.geometry.attributes.position.count);
  assert([...attribute.array].every(value => value >= 0 && value <= 1));
  view.frame(animation.start + animation.duration + 1);
  assert.equal(await done, true); assert(view.removed.has(0));
});

test('changing boards disposes old yellow edge meshes', () => {
  const { view } = fixture(), old = view.featureEdges, geometries = old.children.map(mesh => mesh.geometry);
  let disposed = 0;
  for (const geometry of geometries) geometry.addEventListener('dispose', () => disposed++);
  view.setPuzzle({ size: 4, arrows: [source] });
  assert.equal(disposed, 2); assert.equal(view.featureEdges, null);
  assert(!view.cube.children.includes(old));
});
