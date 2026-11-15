import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { arrowShape, arrowFragments, arrowHead, findArrowCollision, bumpTimings, sampleBumpMotion } from './arrow-motion.js';
import { FACE_BASIS, getGridSize, cellToWorld, seamPoint } from './cube-surface.js';
import { orientArrow, reverseAtProgress } from './arrow-orientation.js';
import { traceExitRoute, redirectorDirection, flippedRedirectorIds } from './routing.js';
import { yellowEdgeGeometries, YELLOW_EDGE_EXTENT } from './yellow-edges.js';

// Face order: front, right, back, left, top, bottom. Every face uses a
// top-left grid origin; the plane UV conversion below shares that convention.
const FACE_ROTATIONS = [
  [0, 0, 0], [0, Math.PI / 2, 0], [0, Math.PI, 0],
  [0, -Math.PI / 2, 0], [-Math.PI / 2, 0, 0], [Math.PI / 2, 0, 0],
];
const INITIAL = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.40, -0.55, -0.025, 'XYZ'));
const INITIAL_CORNERS = [];
for (const x of [-1.024, 1.024]) for (const y of [-1.024, 1.024]) for (const z of [-1.024, 1.024]) {
  INITIAL_CORNERS.push(new THREE.Vector3(x, y, z).applyQuaternion(INITIAL));
}
const INK = '#15191f';
const HINT = '#5b55e7';
const BLOCKED = '#e16457';
const GREEN = '#37b487', GOLD = '#f1c643', BLUE = '#74ccef', PURPLE = '#b64bed';
const COLOR_START = 0.45, COLOR_END = 0.55;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function segmentFraction(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
}

function pathColor(progress) {
  const a = [55, 180, 135], b = [241, 198, 67], t = clamp((progress - COLOR_START) / (COLOR_END - COLOR_START), 0, 1);
  return `rgb(${a.map((value, i) => Math.round(value + (b[i] - value) * t)).join(',')})`;
}

function paintHead(ctx, point, direction, color, unit, shape) {
  const [tip, left, right] = arrowHead(point, direction, shape);
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(tip.x * unit, tip.y * unit); ctx.lineTo(left.x * unit, left.y * unit); ctx.lineTo(right.x * unit, right.y * unit);
  ctx.closePath(); ctx.fill();
}

function paintTwoEnded(ctx, fragment, arrow, color, unit, shape, size, hintReverse) {
  const points = fragment.points.map(point => ({ x: point.x + 0.5, y: point.y + 0.5 }));
  const colored = color === INK, length = arrow.cells.length - 1;
  for (let i = 1; i < points.length; i++) {
    let stroke = color;
    if (colored) {
      const from = fragment.progress[i - 1] / length, to = fragment.progress[i] / length;
      stroke = ctx.createLinearGradient(points[i - 1].x * unit, points[i - 1].y * unit, points[i].x * unit, points[i].y * unit);
      stroke.addColorStop(0, pathColor(from));
      // Keep the transition boundaries exact even when one short segment
      // crosses them both. Endpoint colors alone would spread the gradient.
      for (const boundary of [COLOR_START, COLOR_END]) {
        if (boundary > Math.min(from, to) && boundary < Math.max(from, to)) {
          stroke.addColorStop((boundary - from) / (to - from), pathColor(boundary));
        }
      }
      stroke.addColorStop(1, pathColor(to));
    }
    paintArrow(ctx, [points[i - 1], points[i]], arrow.direction, stroke, unit, shape, false);
  }
  if (fragment.progress[0] === 0) {
    const tailColor = colored ? GREEN : hintReverse === false ? '#a6bac6' : color;
    paintHead(ctx, points[0], orientArrow(arrow, size, true).direction, tailColor, unit, shape);
  }
  if (fragment.head) paintHead(ctx, points.at(-1), arrow.direction, colored ? GOLD : hintReverse === true ? '#a6bac6' : color, unit, shape);
}

function paintRedirector(ctx, marker, unit, flipped) {
  const d = redirectorDirection(marker, flipped), side = { x: -d.y, y: d.x }, center = { x: marker.x + 0.5, y: marker.y + 0.5 };
  ctx.strokeStyle = marker.flipping ? PURPLE : BLUE;
  ctx.lineWidth = unit * (marker.flipping ? 0.15 : 0.12); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const offset of marker.flipping ? [0.14] : [-0.19, 0.17]) {
    const tip = { x: center.x + d.x * (offset + 0.13), y: center.y + d.y * (offset + 0.13) };
    ctx.beginPath();
    ctx.moveTo((tip.x - d.x * 0.24 + side.x * 0.22) * unit, (tip.y - d.y * 0.24 + side.y * 0.22) * unit);
    ctx.lineTo(tip.x * unit, tip.y * unit);
    ctx.lineTo((tip.x - d.x * 0.24 - side.x * 0.22) * unit, (tip.y - d.y * 0.24 - side.y * 0.22) * unit);
    ctx.stroke();
  }
  if (marker.flipping) {
    ctx.fillStyle = PURPLE; ctx.beginPath();
    ctx.arc((center.x - d.x * 0.18) * unit, (center.y - d.y * 0.18) * unit, unit * 0.075, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintArrow(ctx, points, direction, color, unit, shape, hasHead = true) {
  if (!points.length) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = unit * shape.radius * 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(p.x * unit, p.y * unit) : ctx.moveTo(p.x * unit, p.y * unit));
  if (points.length === 1) {
    ctx.moveTo((points[0].x - direction.x * shape.singletonStem) * unit, (points[0].y - direction.y * shape.singletonStem) * unit);
    ctx.lineTo(points[0].x * unit, points[0].y * unit);
  }
  ctx.stroke();
  if (!hasHead) return;
  const [tip, left, right] = arrowHead(points.at(-1), direction, shape);
  ctx.beginPath();
  ctx.moveTo(tip.x * unit, tip.y * unit);
  ctx.lineTo(left.x * unit, left.y * unit);
  ctx.lineTo(right.x * unit, right.y * unit);
  ctx.closePath();
  ctx.fill();
}

const vector = value => new THREE.Vector3(value.x, value.y, value.z);
const faceNormal = face => new THREE.Vector3(...FACE_BASIS[face].normal);

// Distances remain in grid cells. A crease is represented twice, once with each
// face normal, so a ribbon bends over the edge without cutting through the cube.
export function surfaceTrack(arrow, puzzle, route = null) {
  const size = getGridSize(puzzle), scale = 1.024, shape = arrowShape(puzzle);
  const cells = arrow.cells.map(cell => ({ ...cell, face: cell.face ?? arrow.face }));
  const nodes = [];
  cells.forEach((cell, index) => {
    if (index && cell.face !== cells[index - 1].face) {
      const point = vector(seamPoint(cells[index - 1], cell, size)).multiplyScalar(scale);
      nodes.push({ point, normal: faceNormal(cells[index - 1].face), s: index - 0.5 });
      nodes.push({ point: point.clone(), normal: faceNormal(cell.face), s: index - 0.5 });
    }
    nodes.push({ point: vector(cellToWorld(cell, size)).multiplyScalar(scale), normal: faceNormal(cell.face), s: index });
  });
  if (route) {
    let previous = cells.at(-1);
    for (const cell of route.nodes.slice(1)) {
      const s = cells.length - 1 + cell.step;
      if (cell.face !== previous.face) {
        const point = vector(seamPoint(previous, cell, size)).multiplyScalar(scale);
        nodes.push({ point, normal: faceNormal(previous.face), s: s - 0.5 });
        nodes.push({ point: point.clone(), normal: faceNormal(cell.face), s: s - 0.5 });
      }
      nodes.push({ point: vector(cellToWorld(cell, size)).multiplyScalar(scale), normal: faceNormal(cell.face), s });
      previous = cell;
    }
    if (route.exit) {
      const { cell, direction } = route.exit;
      const edge = { face: cell.face, x: cell.x + direction.x * 0.5, y: cell.y + direction.y * 0.5 };
      nodes.push({ point: vector(cellToWorld(edge, size)).multiplyScalar(scale), normal: faceNormal(cell.face), s: cells.length - 1 + route.distance });
    }
  }
  const finalFace = route?.exit?.face ?? route?.nodes.at(-1).face ?? cells.at(-1).face;
  const finalDirection = route?.exit?.direction ?? route?.nodes.at(-1).direction ?? arrow.direction;
  const basis = FACE_BASIS[finalFace];
  const direction = new THREE.Vector3(...basis.u).multiplyScalar(finalDirection.x)
    .addScaledVector(new THREE.Vector3(...basis.v), finalDirection.y);
  const unit = 2 * scale / size;
  if (cells.length === 1) nodes.unshift({ point: nodes[0].point.clone().addScaledVector(direction, -shape.singletonStem * unit),
    normal: nodes[0].normal.clone(), s: -shape.singletonStem });
  return { nodes, unit, direction, length: Math.max(shape.singletonStem, cells.length - 1), head: cells.length - 1,
    surfaceDistance: route?.distance ?? 0, bidirectional: Boolean(arrow.bidirectional) };
}

export function sampleSurfaceTrack(track, s) {
  const last = track.nodes.at(-1);
  if (s >= last.s) return { point: last.point.clone().addScaledVector(track.direction, (s - last.s) * track.unit), normal: last.normal.clone(), direction: track.direction.clone(), s };
  let low = 0, high = track.nodes.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (track.nodes[middle].s <= s) low = middle; else high = middle - 1;
  }
  const index = Math.min(low, track.nodes.length - 2);
  const a = track.nodes[index], b = track.nodes[index + 1];
  return { point: a.point.clone().lerp(b.point, (s - a.s) / (b.s - a.s)), normal: a.normal.clone(),
    direction: b.point.clone().sub(a.point).normalize(), s };
}

function ribbonGeometry(track, distance, shape) {
  const start = track.head + distance - track.length, end = track.head + distance;
  const points = [sampleSurfaceTrack(track, start), ...track.nodes.filter(node => node.s > start && node.s < end), sampleSurfaceTrack(track, end)];
  const positions = [], normals = [], progress = [];
  const triangle = (a, b, c, normal, coordinates) => {
    for (const [i, p] of [a, b, c].entries()) {
      positions.push(p.x, p.y, p.z); normals.push(normal.x, normal.y, normal.z);
      progress.push(clamp((coordinates[i] - start) / track.length, 0, 1));
    }
  };
  const radius = shape.radius * track.unit;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], tangent = b.point.clone().sub(a.point);
    if (tangent.lengthSq() < 1e-12) continue;
    const side = a.normal.clone().cross(tangent.normalize()).multiplyScalar(radius);
    const a1 = a.point.clone().add(side), a2 = a.point.clone().sub(side);
    const b1 = b.point.clone().add(side), b2 = b.point.clone().sub(side);
    triangle(a1, a2, b1, a.normal, [a.s, a.s, b.s]); triangle(a2, b2, b1, a.normal, [a.s, b.s, b.s]);
  }
  for (const node of points) {
    const reference = Math.abs(node.normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = node.normal.clone().cross(reference).normalize(), v = node.normal.clone().cross(u);
    const around = angle => node.point.clone().addScaledVector(u, Math.cos(angle) * radius).addScaledVector(v, Math.sin(angle) * radius);
    for (let i = 0; i < 12; i++) triangle(node.point, around(i * Math.PI / 6), around((i + 1) * Math.PI / 6), node.normal, [node.s, node.s, node.s]);
  }
  function headAt(center, sign) {
    const first = center - sign * shape.base, last = center + sign * shape.tip;
    const boundaries = [first, ...track.nodes.map(node => node.s).filter(s => s > Math.min(first, last) && s < Math.max(first, last)), last].sort((a, b) => sign * (a - b));
    for (let i = 1; i < boundaries.length; i++) {
      const from = boundaries[i - 1], to = boundaries[i];
      if (from === to) continue;
      const frame = sampleSurfaceTrack(track, (from + to) / 2), side = frame.normal.clone().cross(frame.direction).multiplyScalar(sign);
      const a = sampleSurfaceTrack(track, from).point, b = sampleSurfaceTrack(track, to).point;
      const width = s => shape.wing * (shape.tip - sign * (s - center)) / (shape.tip + shape.base) * track.unit;
      const a1 = a.clone().addScaledVector(side, width(from)), a2 = a.clone().addScaledVector(side, -width(from));
      const b1 = b.clone().addScaledVector(side, width(to)), b2 = b.clone().addScaledVector(side, -width(to));
      triangle(a1, a2, b1, frame.normal, [center, center, center]);
      triangle(a2, b2, b1, frame.normal, [center, center, center]);
    }
  }
  headAt(end, 1);
  if (track.bidirectional) headAt(start, -1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('pathProgress', new THREE.Float32BufferAttribute(progress, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function flyingMaterial(initialColor = INK, arrow = null, reverse = false) {
  const color = new THREE.Color(initialColor);
  const material = new THREE.ShaderMaterial({
    uniforms: { ink: { value: color }, opacity: { value: 1 }, colored: { value: arrow?.bidirectional && initialColor === INK ? 1 : 0 },
      tailInk: { value: new THREE.Color(reverse ? GOLD : GREEN) }, headInk: { value: new THREE.Color(reverse ? GREEN : GOLD) },
      colorWindow: { value: new THREE.Vector2(COLOR_START, COLOR_END) } },
    vertexShader: 'attribute float pathProgress; varying float lineProgress; varying vec3 faceNormal; varying vec3 viewDirection; void main(){ lineProgress=pathProgress; vec4 p=modelViewMatrix*vec4(position,1.0); faceNormal=normalMatrix*normal; viewDirection=-p.xyz; gl_Position=projectionMatrix*p; }',
    fragmentShader: 'uniform vec3 ink; uniform vec3 tailInk; uniform vec3 headInk; uniform vec2 colorWindow; uniform float colored; uniform float opacity; varying float lineProgress; varying vec3 faceNormal; varying vec3 viewDirection; void main(){ float nearFace=step(0.0,dot(normalize(faceNormal),normalize(viewDirection))); float blend=clamp((lineProgress-colorWindow.x)/(colorWindow.y-colorWindow.x),0.0,1.0); vec3 lineInk=mix(ink,mix(tailInk,headInk,blend),colored); gl_FragColor=vec4(mix(vec3(1.0),lineInk,nearFace),opacity);\n#include <colorspace_fragment>\n}',
    side: THREE.DoubleSide, transparent: true, depthWrite: true,
  });
  material.color = color;
  return material;
}

export class CubeView {
  constructor(container, { onSelect = () => {}, onInteract = () => {}, motion = 'full' } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.onInteract = onInteract;
    this.disposed = false;
    this.removed = new Set();
    this.blocked = new Set();
    this.animations = new Map();
    this.pointers = new Map();
    this.velocity = { x: 0, y: 0 };
    this.zoom = 1;
    this.framingDistance = 7;
    this.raf = 0;
    this.lastTime = 0;
    this.highlighted = null;
    this.highlightTimer = 0;
    this.events = new AbortController();
    this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.setMotionMode(motion);
    this.motionPreference.addEventListener('change', () => {
      this.setMotionMode(this.motionMode);
      this.schedule();
    }, { signal: this.events.signal });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
    this.camera.position.z = 7;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'cube-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', '3D arrow puzzle. Drag to rotate. Twist two fingers to turn the cube in the screen plane. Pinch to zoom. Tap an arrow to release it. Arrow keys rotate; plus and minus zoom.');
    Object.assign(this.canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none', cursor: 'grab', userSelect: 'none', webkitUserSelect: 'none' });
    container.appendChild(this.canvas);
    this.cube = new THREE.Group();
    this.cube.quaternion.copy(INITIAL);
    this.scene.add(this.cube);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb4c7d9, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(-3, 6, 7);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xd8eaff, 0.6);
    fill.position.set(5, -2, 3);
    this.scene.add(fill);
    this.body = new THREE.Mesh(new RoundedBoxGeometry(2.035, 2.035, 2.035, 3, 0.035),
      new THREE.MeshBasicMaterial({ color: 0xe2f1ff, opacity: 0.15, transparent: true, depthWrite: false }));
    // Composite the cube and edge markings first. Neither writes depth, so
    // every arrow layer remains visible over the gray bands at any rotation.
    this.body.renderOrder = 0;
    this.cube.add(this.body);
    this.edgeFrame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.044, 2.044, 2.044)),
      new THREE.LineBasicMaterial({ color: 0xf4f6ff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.edgeFrame.renderOrder = 1;
    this.cube.add(this.edgeFrame);
    this.faces = FACE_ROTATIONS.map((angles, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1024;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.015, depthWrite: true });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.042, 2.042), material);
      plane.rotation.set(...angles);
      plane.position.copy(new THREE.Vector3(0, 0, 1.021).applyEuler(plane.rotation));
      plane.userData.face = index;
      plane.renderOrder = 4;
      this.cube.add(plane);
      const ghostMaterial = new THREE.ShaderMaterial({ uniforms: { arrows: { value: texture } },
        vertexShader: 'varying vec2 texCoord; void main(){ texCoord=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform sampler2D arrows; varying vec2 texCoord; void main(){ float a=texture2D(arrows,texCoord).a; if(a<0.015)discard; gl_FragColor=vec4(1.0,1.0,1.0,a*0.96); }',
        side: THREE.BackSide, transparent: true, depthWrite: false });
      const ghost = new THREE.Mesh(plane.geometry, ghostMaterial);
      ghost.position.copy(plane.position); ghost.quaternion.copy(plane.quaternion); ghost.renderOrder = 3;
      this.cube.add(ghost);
      return { canvas, ctx: canvas.getContext('2d'), texture, material, plane, ghost, ghostMaterial };
    });
    this.raycaster = new THREE.Raycaster();
    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  setMotionMode(mode = 'full') {
    this.motionMode = ['auto', 'full', 'reduced'].includes(mode) ? mode : 'full';
    this.reducedMotion = this.motionMode === 'reduced'
      || (this.motionMode === 'auto' && this.motionPreference.matches);
    if (this.reducedMotion) this.velocity.x = this.velocity.y = 0;
  }

  resize() {
    if (this.disposed) return;
    const { width, height } = this.container.getBoundingClientRect();
    this.width = Math.max(width, 1); this.height = Math.max(height, 1);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.updateCamera();
  }

  updateCamera() {
    // Start closer, but leave a 5% screen margin around every corner of the
    // angled cube. Refit on resize; manual zoom remains relative to that view.
    const tanY = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanX = tanY * this.camera.aspect;
    const fittedDistance = Math.max(...INITIAL_CORNERS.map(corner => corner.z + Math.max(
      Math.abs(corner.x) / (tanX * 0.9), Math.abs(corner.y) / (tanY * 0.9))));
    const closerDistance = this.framingDistance / Math.min(this.camera.aspect, 1) / 1.35;
    this.camera.position.z = Math.max(closerDistance, fittedDistance) / this.zoom;
    this.camera.updateProjectionMatrix();
    this.schedule();
  }

  setPuzzle(puzzle, removedSet = new Set(), blockedSet = new Set()) {
    this.cancelAnimations(false);
    this.puzzle = puzzle;
    this.visibleFlips = new Set(flippedRedirectorIds(puzzle));
    // Every dimension brings the cube a little closer, up to the screen-fit
    // limit that keeps the angled starting view fully visible.
    // Dimension 2 starts at 7 units, and large cubes approach 6.4 units (~9% growth).
    this.framingDistance = 7 - 0.6 * (1 - Math.exp(-Math.max(0, puzzle.size - 2) / 10));
    this.updateCamera();
    this.removed = new Set(removedSet);
    this.arrowById = new Map(puzzle.arrows.map(a => [a.id, a]));
    this.blocked = new Set([...blockedSet].filter(id => this.arrowById.has(id)));
    this.fragmentsById = new Map(puzzle.arrows.map(a => [a.id, arrowFragments(a, getGridSize(puzzle))]));
    this.arrowsByFace = this.faces.map((_, face) => puzzle.arrows.filter(a => this.fragmentsById.get(a.id).some(fragment => fragment.face === face)));
    this.setFeatureEdges(puzzle.wrapEdges || []);
    this.highlighted = null;
    clearTimeout(this.highlightTimer);
    const resolution = Math.min(2048, Math.max(768, getGridSize(puzzle) * 64));
    for (const face of this.faces) {
      if (face.canvas.width === resolution && face.canvas.height === resolution) continue;
      // WebGL texture storage cannot resize after upload. Replace both the near
      // and ghost face bindings together, then release the old GPU allocation.
      const previous = face.texture;
      face.canvas.width = face.canvas.height = resolution;
      const texture = new THREE.CanvasTexture(face.canvas);
      texture.colorSpace = previous.colorSpace;
      texture.anisotropy = previous.anisotropy;
      face.texture = texture;
      face.material.map = texture;
      face.ghostMaterial.uniforms.arrows.value = texture;
      previous.dispose();
    }
    this.drawFaces();
    this.schedule();
  }

  setFeatureEdges(edges) {
    if (this.featureEdges) {
      for (const mesh of this.featureEdges.children) { mesh.geometry.dispose(); mesh.material.dispose(); }
      this.cube.remove(this.featureEdges); this.featureEdges = null;
    }
    if (!edges.length) return;
    this.featureEdges = new THREE.Group();
    for (const [index, geometry] of yellowEdgeGeometries(edges).entries()) {
      const material = new THREE.MeshBasicMaterial({ color: '#939ba6', transparent: true, opacity: 1, depthWrite: false });
      const backColor = new THREE.Color('#939ba6'), frontColor = new THREE.Color('#68737f');
      const mesh = new THREE.Mesh(geometry, material); mesh.renderOrder = 2;
      const [a, b] = edges[index], normalA = faceNormal(a), normalB = faceNormal(b);
      const center = normalA.clone().add(normalB).multiplyScalar(YELLOW_EDGE_EXTENT), eye = new THREE.Vector3();
      mesh.onBeforeRender = (_renderer, _scene, camera) => {
        // An edge belongs to both faces. Make it solid as soon as either face
        // turns toward the camera; keep the far-side band faint and lighter.
        camera.getWorldPosition(eye);
        mesh.worldToLocal(eye).sub(center).normalize();
        const facing = Math.max(eye.dot(normalA), eye.dot(normalB));
        const visible = THREE.MathUtils.smoothstep(facing, -0.12, 0);
        material.opacity = THREE.MathUtils.lerp(0.15, 1, visible);
        material.color.copy(backColor).lerp(frontColor, visible);
      };
      this.featureEdges.add(mesh);
    }
    this.cube.add(this.featureEdges);
  }

  drawFaces(onlyFace = null) {
    if (!this.puzzle) return;
    const size = getGridSize(this.puzzle), shape = arrowShape(this.puzzle);
    this.faces.forEach((face, index) => {
      if (onlyFace !== null && index !== onlyFace) return;
      const { ctx, canvas, texture } = face, unit = canvas.width / size;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const marker of this.puzzle.redirectors || []) if (marker.face === index) paintRedirector(ctx, marker, unit, this.visibleFlips.has(marker.id));
      for (const arrow of this.arrowsByFace[index]) {
        if (this.removed.has(arrow.id) || this.animations.has(arrow.id)) continue;
        const color = this.highlighted?.id === arrow.id ? (this.highlighted.type === 'blocked' ? BLOCKED : HINT)
          : this.blocked.has(arrow.id) ? BLOCKED : INK;
        for (const fragment of this.fragmentsById.get(arrow.id)) {
          if (fragment.face !== index) continue;
          if (arrow.bidirectional) {
            const hinted = this.highlighted?.id === arrow.id && this.highlighted.type === 'hint';
            paintTwoEnded(ctx, fragment, arrow, color, unit, shape, size, hinted ? Boolean(this.highlighted.reverse) : undefined);
          } else paintArrow(ctx, fragment.points.map(p => ({ x: p.x + 0.5, y: p.y + 0.5 })), arrow.direction, color, unit, shape, fragment.head);
        }
      }
      texture.needsUpdate = true;
    });
    this.schedule();
  }

  pick(clientX, clientY) {
    return this.pickMove(clientX, clientY)?.id ?? null;
  }

  pickMove(clientX, clientY) {
    if (!this.puzzle) return null;
    const rect = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.cube.updateMatrixWorld(true);
    this.raycaster.setFromCamera(mouse, this.camera);
    const hit = this.raycaster.intersectObjects(this.faces.map(f => f.plane), false)[0];
    if (!hit) return null;
    const size = getGridSize(this.puzzle), shape = arrowShape(this.puzzle);
    const p = { x: hit.uv.x * size - 0.5, y: (1 - hit.uv.y) * size - 0.5 };
    let best = null, bestDistance = Math.max(0.34, shape.wing + 0.04);
    for (const arrow of this.arrowsByFace[hit.object.userData.face]) {
      if (this.removed.has(arrow.id) || this.animations.has(arrow.id)) continue;
      const consider = (distance, progress) => {
        if (distance < bestDistance) { bestDistance = distance; best = { id: arrow.id, reverse: reverseAtProgress(arrow, progress) }; }
      };
      for (const fragment of this.fragmentsById.get(arrow.id)) {
        if (fragment.face !== hit.object.userData.face) continue;
        for (let i = 1; i < fragment.points.length; i++) {
          const t = segmentFraction(p, fragment.points[i - 1], fragment.points[i]);
          consider(distanceToSegment(p, fragment.points[i - 1], fragment.points[i]), fragment.progress[i - 1] + t * (fragment.progress[i] - fragment.progress[i - 1]));
        }
        if (arrow.bidirectional && fragment.progress[0] === 0) {
          const tail = fragment.points[0], d = orientArrow(arrow, size, true).direction;
          consider(distanceToSegment(p, { x: tail.x - d.x * shape.base, y: tail.y - d.y * shape.base },
            { x: tail.x + d.x * shape.tip, y: tail.y + d.y * shape.tip }), 0);
        }
        if (!fragment.head) continue;
        const head = arrow.cells.at(-1), d = arrow.direction;
        const stem = arrow.cells.length === 1 ? shape.singletonStem : shape.base;
        consider(distanceToSegment(p, { x: head.x - d.x * stem, y: head.y - d.y * stem },
          { x: head.x + d.x * shape.tip, y: head.y + d.y * shape.tip }), arrow.cells.length - 1);
      }
    }
    return best;
  }

  highlight(id, type = 'hint', reverse = false) {
    clearTimeout(this.highlightTimer);
    this.highlighted = { id, type, reverse };
    this.drawFaces();
    if (type === 'blocked') this.highlightTimer = setTimeout(() => this.clearHighlight(), 650);
  }

  clearHighlight() {
    clearTimeout(this.highlightTimer);
    if (this.disposed) return;
    this.highlighted = null;
    this.drawFaces();
  }

  drawArrowFaces(arrow) {
    for (const face of new Set(arrow.cells.map(cell => cell.face ?? arrow.face))) this.drawFaces(face);
  }

  animateRedirectors(animation, distance) {
    const events = animation.route?.flips || [];
    let count = 0;
    while (count < events.length && events[count].at <= distance + 1e-7) count++;
    if (count === (animation.flipCount || 0)) return;
    const next = new Set(animation.initialFlips), faces = new Set();
    for (const event of events.slice(0, count)) {
      if (event.flipped) next.add(event.id); else next.delete(event.id);
    }
    for (const event of events) if (next.has(event.id) !== this.visibleFlips.has(event.id)) faces.add(event.face);
    this.visibleFlips = next; animation.flipCount = count;
    for (const face of faces) this.drawFaces(face);
  }

  removeArrow(id, { reverse = false } = {}) {
    const original = this.arrowById?.get(id);
    if (this.disposed || !original || this.removed.has(id) || (reverse && !original.bidirectional)) return Promise.resolve(false);
    if (this.animations.has(id)) return this.animations.get(id).promise;
    const arrow = orientArrow(original, getGridSize(this.puzzle), reverse);
    const routed = Boolean(this.puzzle.generatorVersion >= 11 || this.puzzle.wrapEdges?.length || this.puzzle.redirectors?.length || arrow.bidirectional);
    const route = routed ? traceExitRoute(this.puzzle, original, reverse) : null;
    const shape = arrowShape(this.puzzle), track = surfaceTrack(arrow, this.puzzle, route);
    const material = flyingMaterial(this.blocked.has(id) ? BLOCKED : INK, arrow, reverse);
    const mesh = new THREE.Mesh(ribbonGeometry(track, 0, shape), material);
    mesh.renderOrder = 5;
    this.cube.add(mesh);
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    const head = arrow.cells.at(-1), direction = arrow.direction, size = getGridSize(this.puzzle);
    const edgeDistance = direction.x > 0 ? size - 0.5 - head.x : direction.x < 0 ? head.x + 0.5
      : direction.y > 0 ? size - 0.5 - head.y : head.y + 0.5;
    const clearDistance = track.length + (route?.distance ?? edgeDistance) + 0.35;
    const animation = { kind: 'remove', arrow, mesh, material, shape, track, clearDistance, travel: clearDistance + size * 1.3,
      route, reverse, initialFlips: new Set(this.visibleFlips), reducedMotion: this.reducedMotion, start: performance.now(),
      duration: this.reducedMotion ? 150 : routed ? Math.min(1100, 260 + (track.length + route.distance) * 6) : Math.min(520, 260 + arrow.cells.length * 4), resolve, promise };
    this.animations.set(id, animation);
    this.drawArrowFaces(arrow);
    this.schedule();
    return promise;
  }

  bumpArrow(id, { onImpact = () => {}, reverse = false } = {}) {
    const original = this.arrowById?.get(id);
    if (this.disposed || !original || this.removed.has(id) || (reverse && !original.bidirectional)) return Promise.resolve(false);
    if (this.animations.has(id)) return this.animations.get(id).promise;
    const collision = findArrowCollision(this.puzzle, original, this.removed, reverse);
    if (!collision) return Promise.resolve(false);
    if (this.highlighted?.id === id) { this.highlighted = null; clearTimeout(this.highlightTimer); }
    const arrow = orientArrow(original, getGridSize(this.puzzle), reverse);
    const routed = Boolean(this.puzzle.generatorVersion >= 11 || this.puzzle.wrapEdges?.length || this.puzzle.redirectors?.length || arrow.bidirectional);
    const route = routed ? traceExitRoute(this.puzzle, original, reverse) : null;
    const shape = arrowShape(this.puzzle), track = surfaceTrack(arrow, this.puzzle, route);
    const material = flyingMaterial(this.blocked.has(id) ? BLOCKED : INK, arrow, reverse);
    const mesh = new THREE.Mesh(ribbonGeometry(track, 0, shape), material);
    mesh.renderOrder = 5;
    this.cube.add(mesh);
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    this.animations.set(id, { kind: 'bump', arrow, mesh, material, shape, track, start: performance.now(),
      distance: collision.distance, timings: bumpTimings(collision.distance, this.reducedMotion, routed), route, reverse,
      initialFlips: new Set(this.visibleFlips),
      reducedMotion: this.reducedMotion, lastDistance: 0, impacted: false, onImpact, resolve, promise });
    this.drawArrowFaces(arrow);
    this.schedule();
    return promise;
  }

  cancelAnimations(redraw = true) {
    const changedFaces = new Set();
    for (const animation of this.animations.values()) {
      for (const cell of animation.arrow.cells) changedFaces.add(cell.face ?? animation.arrow.face);
      this.cube.remove(animation.mesh);
      animation.mesh.geometry.dispose(); animation.material.dispose();
      animation.resolve(false);
    }
    this.animations.clear();
    if (redraw && !this.disposed) for (const face of changedFaces) this.drawFaces(face);
  }

  resetView() {
    this.velocity.x = this.velocity.y = 0;
    this.zoom = 1;
    this.updateCamera();
    this.orientationTween = { from: this.cube.quaternion.clone(), to: INITIAL.clone(), start: performance.now(), duration: this.reducedMotion ? 0 : 380 };
    this.schedule();
  }

  focusFace(face) {
    if (!this.faces[face]) return;
    // A hint should reveal its whole face even if the player had zoomed in.
    this.zoom = Math.min(this.zoom, 1.25);
    this.updateCamera();
    const inverse = this.faces[face].plane.quaternion.clone().invert();
    this.velocity.x = this.velocity.y = 0;
    this.orientationTween = { from: this.cube.quaternion.clone(), to: inverse, start: performance.now(), duration: this.reducedMotion ? 0 : 420 };
    this.schedule();
  }

  // The third argument follows a clockwise two-finger twist in screen space.
  rotateBy(dx, dy, twist = 0) {
    this.orientationTween = null;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(dy, dx, -twist, 'XYZ'));
    this.cube.quaternion.premultiply(q).normalize();
    this.schedule();
  }

  bindInput() {
    const options = { signal: this.events.signal };
    this.canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      this.canvas.focus({ preventScroll: true });
      this.canvas.setPointerCapture(event.pointerId);
      const now = performance.now();
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
        lastTime: now, lastMoveTime: now, dragged: false });
      this.velocity.x = this.velocity.y = 0;
      this.orientationTween = null;
      if (this.pointers.size > 1) {
        for (const pointer of this.pointers.values()) pointer.dragged = true;
        this.pinchDistance = this.pointerDistance();
        this.pinchAngle = this.pointerAngle();
      }
      this.onInteract();
    }, options);
    this.canvas.addEventListener('pointermove', event => {
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer) {
        if (event.pointerType === 'mouse') this.canvas.style.cursor = this.pick(event.clientX, event.clientY) !== null ? 'pointer' : 'grab';
        return;
      }
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      const now = performance.now(), elapsed = Math.max(4, now - pointer.lastTime);
      pointer.lastTime = now;
      if (Math.hypot(dx, dy) > 0.5) pointer.lastMoveTime = now;
      pointer.x = event.clientX; pointer.y = event.clientY;
      if (this.pointers.size > 1) {
        const distance = this.pointerDistance();
        const angle = this.pointerAngle();
        if (this.pinchDistance > 1) this.zoom = clamp(this.zoom * distance / this.pinchDistance, 0.65, 2.2);
        // Ignore nearly coincident fingers, and use the shortest angle across
        // the -PI/PI boundary so a small twist cannot spin the cube a full turn.
        if (this.pinchDistance > 8 && distance > 8) {
          const delta = angle - this.pinchAngle;
          this.rotateBy(0, 0, Math.atan2(Math.sin(delta), Math.cos(delta)));
        }
        this.pinchDistance = distance;
        this.pinchAngle = angle;
        this.velocity.x = this.velocity.y = 0;
        this.updateCamera();
        return;
      }
      if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 6) pointer.dragged = true;
      if (!pointer.dragged) return;
      this.canvas.style.cursor = 'grabbing';
      const rotationX = dx * 0.006, rotationY = dy * 0.006;
      // Estimate per-frame angular speed, so 120 Hz phones and 60 Hz mice have
      // comparable inertia. Smoothing and a cap prevent a coalesced event flinging the cube.
      this.velocity.x = clamp(this.velocity.x * 0.45 + rotationX * 16.67 / elapsed * 0.55, -0.14, 0.14);
      this.velocity.y = clamp(this.velocity.y * 0.45 + rotationY * 16.67 / elapsed * 0.55, -0.14, 0.14);
      this.rotateBy(rotationX, rotationY);
    }, options);
    const release = event => {
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer) return;
      this.pointers.delete(event.pointerId);
      // Removing one of three fingers changes the active pair. Rebase both
      // measurements instead of treating that change as a pinch or twist.
      this.pinchDistance = this.pointerDistance();
      this.pinchAngle = this.pointerAngle();
      if (!this.pointers.size) this.canvas.style.cursor = 'grab';
      if (this.pointers.size === 1) {
        const remaining = this.pointers.values().next().value;
        remaining.startX = remaining.x; remaining.startY = remaining.y; remaining.dragged = true;
      }
      if (event.type === 'pointerup' && !pointer.dragged) {
        const move = this.pickMove(event.clientX, event.clientY);
        if (move !== null) this.onSelect(move.id, move.reverse);
      }
      // Holding still before release is a deliberate stop, rather than a fling.
      if (event.type !== 'pointerup' || performance.now() - pointer.lastMoveTime > 100) this.velocity.x = this.velocity.y = 0;
      this.schedule();
    };
    this.canvas.addEventListener('pointerup', release, options);
    this.canvas.addEventListener('pointercancel', release, options);
    this.canvas.addEventListener('lostpointercapture', release, options);
    this.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      this.zoom = clamp(this.zoom * Math.exp(-event.deltaY * 0.001), 0.65, 2.2);
      this.onInteract(); this.updateCamera();
    }, { ...options, passive: false });
    this.canvas.addEventListener('keydown', event => {
      const moves = { ArrowLeft: [-0.22, 0], ArrowRight: [0.22, 0], ArrowUp: [0, -0.22], ArrowDown: [0, 0.22] };
      if (moves[event.key]) { event.preventDefault(); this.velocity.x = this.velocity.y = 0; this.rotateBy(...moves[event.key]); this.onInteract(); }
      if (event.key === '+' || event.key === '=' || event.key === '-') {
        event.preventDefault(); this.zoom = clamp(this.zoom * (event.key === '-' ? 0.9 : 1.1), 0.65, 2.2); this.updateCamera();
      }
    }, options);
    this.canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
  }

  pointerDistance() {
    const [a, b] = this.pointers.values();
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  pointerAngle() {
    const [a, b] = this.pointers.values();
    return a && b ? Math.atan2(b.y - a.y, b.x - a.x) : 0;
  }

  schedule() {
    if (this.disposed || this.raf) return;
    this.raf = requestAnimationFrame(time => this.frame(time));
  }

  frame(time) {
    this.raf = 0;
    if (this.disposed) return;
    const dt = Math.min((time - (this.lastTime || time - 16)) / 16.67, 3);
    this.lastTime = time;
    let active = false;
    if (!this.pointers.size && !this.reducedMotion && Math.hypot(this.velocity.x, this.velocity.y) > 0.00025) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.velocity.y * dt, this.velocity.x * dt, 0, 'XYZ'));
      this.cube.quaternion.premultiply(q).normalize();
      const friction = Math.pow(0.9, dt);
      this.velocity.x *= friction; this.velocity.y *= friction; active = true;
    }
    if (this.orientationTween) {
      const tween = this.orientationTween;
      const t = tween.duration ? clamp((time - tween.start) / tween.duration, 0, 1) : 1;
      const ease = 1 - Math.pow(1 - t, 3);
      this.cube.quaternion.slerpQuaternions(tween.from, tween.to, ease);
      if (t === 1) this.orientationTween = null; else active = true;
    }
    for (const [id, animation] of this.animations) {
      if (animation.kind === 'bump') {
        const state = sampleBumpMotion(time - animation.start, animation.distance, animation.timings, animation.reducedMotion, this.blocked.has(id));
        // Returning along the frozen route unwinds temporary flips in reverse
        // order. Reduced motion changes them at impact and restores at completion.
        this.animateRedirectors(animation, state.complete ? -Infinity : animation.reducedMotion
          ? (state.impacted ? animation.distance : -Infinity) : state.distance);
        if (state.distance !== animation.lastDistance) {
          animation.mesh.geometry.dispose();
          animation.mesh.geometry = ribbonGeometry(animation.track, state.distance, animation.shape);
          animation.lastDistance = state.distance;
        }
        animation.material.color.set(state.color === 'blocked' ? BLOCKED : INK);
        animation.material.uniforms.colored.value = animation.arrow.bidirectional && state.color !== 'blocked' ? 1 : 0;
        if (state.impacted && !animation.impacted) {
          animation.impacted = true;
          this.blocked.add(id);
          animation.onImpact();
          // An impact handler may reset the board or dispose the view.
          if (!this.animations.has(id)) continue;
        }
        if (state.complete) {
          this.cube.remove(animation.mesh);
          animation.mesh.geometry.dispose(); animation.material.dispose();
          this.animations.delete(id);
          this.drawArrowFaces(animation.arrow);
          animation.resolve(true);
        } else active = true;
        continue;
      }
      const t = clamp((time - animation.start) / animation.duration, 0, 1);
      const distance = animation.reducedMotion ? 0 : animation.travel * t * t;
      this.animateRedirectors(animation, animation.reducedMotion ? (t === 1 ? Infinity : -Infinity) : distance);
      if (!animation.reducedMotion) {
        animation.mesh.geometry.dispose();
        animation.mesh.geometry = ribbonGeometry(animation.track, distance, animation.shape);
      }
      // Keep the whole arrow solid until its tail clears the edge. Only the
      // airborne portion fades, so long paths never dissolve while still on the board.
      animation.material.uniforms.opacity.value = animation.reducedMotion ? 1 - t
        : 1 - clamp((distance - animation.clearDistance) / (animation.travel - animation.clearDistance), 0, 1);
      if (t === 1) {
        this.cube.remove(animation.mesh);
        animation.mesh.geometry.dispose(); animation.material.dispose();
        this.animations.delete(id); this.removed.add(id); animation.resolve(true);
      } else active = true;
    }
    this.renderer.render(this.scene, this.camera);
    if (active) this.schedule();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.highlightTimer);
    this.events.abort();
    this.resizeObserver.disconnect();
    this.cancelAnimations();
    this.setFeatureEdges([]);
    this.body.geometry.dispose(); this.body.material.dispose();
    this.edgeFrame.geometry.dispose(); this.edgeFrame.material.dispose();
    for (const face of this.faces) { face.plane.geometry.dispose(); face.material.dispose(); face.ghostMaterial.dispose(); face.texture.dispose(); }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
