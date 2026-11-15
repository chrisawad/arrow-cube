import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CubeView, surfaceTrack, sampleSurfaceTrack } from '../src/cube-view.js';
import { traceExitRoute, cubeEdges } from '../src/routing.js';
import { yellowEdgeGeometries } from '../src/yellow-edges.js';
import { cellToWorld } from '../src/cube-surface.js';
import { arrowFragments, findArrowCollision } from '../src/arrow-motion.js';
import { DEFAULT_THEME } from '../src/theme.js';

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
    const ctx = { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {},
      createLinearGradient() { return { addColorStop() {} }; },
      stroke() { strokes.push(this.strokeStyle); }, fill() { fills.push(this.fillStyle); } };
    return { canvas, texture, ctx, plane: new THREE.Mesh(), material: { map: texture }, ghostMaterial: { uniforms: { arrows: { value: texture }, ghostInk: { value: new THREE.Color('#ffffff') } } } };
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

test('facing slide bands block far-side arrows while faded bands do not write opaque depth', () => {
  const { view } = fixture(), mesh = view.featureEdges.children[0];
  mesh.geometry.computeBoundingSphere();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
  const renderFrom = position => {
    camera.position.copy(position); camera.updateMatrixWorld();
    mesh.updateWorldMatrix(true, false);
    mesh.onBeforeRender(null, null, camera);
  };
  for (const rotation of [[0, 0, 0], [.4, -.55, -.025]]) {
    view.cube.rotation.set(...rotation);
    renderFrom(new THREE.Vector3(0, 0, 7));
    assert.equal(mesh.material.opacity, 1);
    assert.equal(mesh.material.depthWrite, true, 'solid bands must occlude far-side moving arrows');
    // Compare real band geometry with the enclosing near/far arrow planes.
    // The near arrow must win the depth test; the far arrow must fail it.
    const center = mesh.geometry.boundingSphere.center.clone().applyMatrix4(mesh.matrixWorld);
    const raycaster = new THREE.Raycaster(camera.position, center.clone().sub(camera.position).normalize());
    const hit = raycaster.intersectObject(mesh)[0];
    assert(hit, 'the test ray must cross the slide band');
    const box = new THREE.Box3(new THREE.Vector3(-1.021, -1.021, -1.021), new THREE.Vector3(1.021, 1.021, 1.021));
    const localRay = raycaster.ray.clone().applyMatrix4(mesh.matrixWorld.clone().invert());
    const near = localRay.intersectBox(box, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    assert(camera.position.distanceTo(near) < hit.distance, 'front arrows stay above the band');
    const farRay = new THREE.Ray(raycaster.ray.at(20, new THREE.Vector3()),
      raycaster.ray.direction.clone().negate()).applyMatrix4(mesh.matrixWorld.clone().invert());
    const far = farRay.intersectBox(box, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    assert(camera.position.distanceTo(far) > hit.distance, 'far arrows lie behind the band');
  }
  view.cube.rotation.set(0, 0, 0);
  renderFrom(new THREE.Vector3(-7, 0, -7));
  assert.equal(mesh.material.opacity, .15);
  assert.equal(mesh.material.depthWrite, false, 'far-side bands must remain see-through after rotation');
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

const purpleFixture = (blocked = false) => ({ size: 7, gridSize: 7, generatorVersion: 13,
  redirectors: [{ id: 9, face: 0, x: 3, y: 3, direction: down, flipping: true, flipped: false }],
  arrows: [{ ...source, cells: [0, 1, 2].map(x => ({ face: 0, x, y: 3 })) },
    ...(blocked ? [{ id: 1, face: 0, direction: right, cells: [3, 4, 5].map(x => ({ face: 0, x, y: 5 })) }] : [])] });

test('purple marker flips exactly as the leading tip passes, once even across skipped frames', async () => {
  const { view, strokes, fills } = fixture(purpleFixture());
  assert(strokes.includes('#b64bed') && fills.includes('#b64bed'), 'purple chevron and dot are painted');
  const done = view.removeArrow(0), animation = view.animations.get(0); animation.start = 1000;
  const frameAt = distance => view.frame(1000 + Math.sqrt(distance / animation.travel) * animation.duration);
  frameAt(0.9); assert(!view.visibleFlips.has(9));
  frameAt(1.1); assert(view.visibleFlips.has(9));
  frameAt(2.1); assert(view.visibleFlips.has(9));
  view.frame(1000 + animation.duration + 1);
  assert(await done); assert(view.visibleFlips.has(9));
});

test('collision rollback restores purple direction and cannot flip a marker beyond the impact', async () => {
  for (const reduced of [false, true]) {
    const puzzle = purpleFixture(true);
    puzzle.redirectors.push({ id: 10, face: 0, x: 3, y: 6, direction: right, flipping: true });
    const { view } = fixture(puzzle); view.reducedMotion = reduced;
    let ticks = 0;
    const done = view.bumpArrow(0, { onImpact: () => ticks++ }), animation = view.animations.get(0);
    animation.start = 1000;
    view.frame(1000 + animation.timings.outbound);
    assert(view.visibleFlips.has(9)); assert(!view.visibleFlips.has(10));
    assert.equal(ticks, 1);
    view.frame(1000 + animation.timings.outbound + animation.timings.hold + animation.timings.rollback);
    assert(await done); assert(!view.visibleFlips.has(9)); assert(!view.visibleFlips.has(10));
    assert.equal(ticks, 1); assert(view.blocked.has(0));
    assert.equal(puzzle.redirectors[0].flipped, false, 'bump previews cannot change saved board state');
  }
});

test('reduced motion and a backgrounded tab still apply all departure flips', async () => {
  for (const reduced of [false, true]) {
    const { view } = fixture(purpleFixture()); view.reducedMotion = reduced;
    const done = view.removeArrow(0), animation = view.animations.get(0);
    assert(!view.visibleFlips.has(9));
    view.frame(animation.start + animation.duration + 5000);
    assert(await done); assert(view.visibleFlips.has(9));
  }
});

test('switching boards during a purple animation clears its transient direction', async () => {
  const { view } = fixture(purpleFixture(true));
  const done = view.bumpArrow(0), animation = view.animations.get(0);
  view.frame(animation.start + animation.timings.outbound);
  assert(view.visibleFlips.has(9));
  view.setPuzzle(purpleFixture());
  assert.equal(await done, false); assert.equal(view.visibleFlips.size, 0);
});


test('live themes repaint markers, arrowheads, ghost faces and solid bands without replacing board geometry', () => {
  const puzzle = { ...chain, redirectors: [...chain.redirectors, { id: 5, face: 0, x: 2, y: 2, direction: down, flipping: true }],
    arrows: [{ ...source, bidirectional: true }] };
  const { view, fills, strokes } = fixture(puzzle), edges = view.featureEdges, geometry = edges.children[0].geometry;
  const theme = { ...DEFAULT_THEME, edge: '#cc6600', end1: '#ff0000', end2: '#0000ff', fixed: '#113355', flip: '#557799', ghost: '#aabbcc' };
  view.setTheme(theme);
  assert.equal(view.puzzle, puzzle); assert.equal(view.featureEdges, edges); assert.equal(edges.children[0].geometry, geometry);
  assert(fills.includes(theme.end1) && fills.includes(theme.end2));
  assert(strokes.includes(theme.fixed) && strokes.includes(theme.flip));
  assert(view.faces.every(face => face.ghostMaterial.uniforms.ghostInk.value.getHexString() === 'aabbcc'));
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 0, 7); camera.updateMatrixWorld();
  edges.children[0].updateWorldMatrix(true, false); edges.children[0].onBeforeRender(null, null, camera);
  assert.equal(edges.children[0].material.color.getHexString(), 'cc6600');
  assert.equal(edges.children[0].material.opacity, 1); assert.equal(edges.children[0].material.depthWrite, true);
  // Matching user-selected ink/crash colors must not turn blocked double arrows back into colored ones.
  view.blocked.add(0); fills.length = 0;
  view.setTheme({ ...theme, ink: '#ff0000', crash: '#ff0000' });
  assert(!fills.includes(theme.end2));
});

test('live theme edits preserve reverse departure progress and color its actual leading end', async () => {
  const { view } = fixture({ ...chain, arrows: [{ ...source, bidirectional: true }] });
  const done = view.removeArrow(0, { reverse: true }), animation = view.animations.get(0);
  const geometry = animation.mesh.geometry, start = animation.start, route = animation.route;
  view.setTheme({ ...DEFAULT_THEME, end1: '#123456', end2: '#abcdef', ghost: '#dddddd' });
  assert.equal(view.animations.get(0), animation); assert.equal(animation.mesh.geometry, geometry);
  assert.equal(animation.start, start); assert.equal(animation.route, route);
  assert.equal(animation.material.uniforms.headInk.value.getHexString(), '123456');
  assert.equal(animation.material.uniforms.tailInk.value.getHexString(), 'abcdef');
  assert.equal(animation.material.uniforms.ghostInk.value.getHexString(), 'dddddd');
  view.frame(start + animation.duration + 1); assert.equal(await done, true);
});

test('a collision uses updated theme colors before contact, on impact, and after rollback', async () => {
  const blocker = { id: 1, face: 5, direction: right, cells: [1, 2, 3].map(x => ({ face: 5, x, y: 3 })) };
  const { view, fills } = fixture({ ...chain, arrows: [source, blocker] });
  const done = view.bumpArrow(0), animation = view.animations.get(0); animation.start = 1000;
  const theme = { ...DEFAULT_THEME, ink: '#123456', crash: '#654321' };
  view.setTheme(theme);
  view.frame(1000 + animation.timings.outbound - 1);
  assert.equal(animation.material.color.getHexString(), '123456');
  view.frame(1000 + animation.timings.outbound);
  assert.equal(animation.material.color.getHexString(), '654321');
  view.setTheme({ ...theme, crash: '#ff0000' });
  view.frame(1000 + animation.timings.outbound + animation.timings.hold + animation.timings.rollback + 1);
  assert.equal(await done, true); assert(view.blocked.has(0)); assert(fills.includes('#ff0000'));
});
