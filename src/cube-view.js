import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Face order: front, right, back, left, top, bottom. Every face uses a
// top-left grid origin; the plane UV conversion below shares that convention.
const FACE_ROTATIONS = [
  [0, 0, 0], [0, Math.PI / 2, 0], [0, Math.PI, 0],
  [0, -Math.PI / 2, 0], [-Math.PI / 2, 0, 0], [Math.PI / 2, 0, 0],
];
const INITIAL = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.40, -0.55, -0.025, 'XYZ'));
const INK = '#15191f';
const HINT = '#5b55e7';
const BLOCKED = '#e16457';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function paintArrow(ctx, points, direction, color, unit) {
  if (!points.length) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = unit * 0.19;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(p.x * unit, p.y * unit) : ctx.moveTo(p.x * unit, p.y * unit));
  if (points.length === 1) {
    ctx.moveTo((points[0].x - direction.x * 0.3) * unit, (points[0].y - direction.y * 0.3) * unit);
    ctx.lineTo(points[0].x * unit, points[0].y * unit);
  }
  ctx.stroke();
  const h = points.at(-1), d = direction;
  const tip = { x: h.x + d.x * 0.32, y: h.y + d.y * 0.32 };
  const base = { x: h.x - d.x * 0.14, y: h.y - d.y * 0.14 };
  ctx.beginPath();
  ctx.moveTo(tip.x * unit, tip.y * unit);
  ctx.lineTo((base.x - d.y * 0.26) * unit, (base.y + d.x * 0.26) * unit);
  ctx.lineTo((base.x + d.y * 0.26) * unit, (base.y - d.x * 0.26) * unit);
  ctx.closePath();
  ctx.fill();
}

// Clip a sliding interval out of a path, extending its head along the exit ray.
// The original turns remain in place until the tail passes them, just like a snake.
function slidingPath(arrow, distance) {
  const cells = arrow.cells, last = cells.at(-1), length = Math.max(0.6, cells.length - 1);
  const sample = (s) => {
    if (s < 0) return { x: cells[0].x - arrow.direction.x * -s, y: cells[0].y - arrow.direction.y * -s };
    if (s >= cells.length - 1) return { x: last.x + arrow.direction.x * (s - cells.length + 1), y: last.y + arrow.direction.y * (s - cells.length + 1) };
    const index = Math.floor(s), t = s - index, a = cells[index], b = cells[index + 1];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const start = distance + cells.length - 1 - length;
  const end = distance + cells.length - 1;
  const result = [sample(start)];
  for (let i = Math.max(0, Math.floor(start) + 1); i < Math.min(cells.length, end); i++) result.push(cells[i]);
  result.push(sample(end));
  return result;
}

// A flat, round-joined 3D ribbon can extend beyond the textured face. This avoids
// clipping the departure at the cube boundary and keeps every arrow direction exact.
function ribbonGeometry(points, direction, size) {
  const vertices = [];
  const push = (x, y) => vertices.push((x + 0.5) / size * 2 - 1, 1 - (y + 0.5) / size * 2, 0);
  const triangle = (a, b, c) => { push(a.x, a.y); push(b.x, b.y); push(c.x, c.y); };
  const radius = 0.095;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / length * radius, ny = (b.x - a.x) / length * radius;
    const a1 = { x: a.x + nx, y: a.y + ny }, a2 = { x: a.x - nx, y: a.y - ny };
    const b1 = { x: b.x + nx, y: b.y + ny }, b2 = { x: b.x - nx, y: b.y - ny };
    triangle(a1, a2, b1); triangle(a2, b2, b1);
  }
  for (const p of points) {
    for (let i = 0; i < 10; i++) {
      const a = i * Math.PI / 5, b = (i + 1) * Math.PI / 5;
      triangle(p, { x: p.x + Math.cos(a) * radius, y: p.y + Math.sin(a) * radius }, { x: p.x + Math.cos(b) * radius, y: p.y + Math.sin(b) * radius });
    }
  }
  const h = points.at(-1), d = direction;
  triangle({ x: h.x + d.x * 0.32, y: h.y + d.y * 0.32 },
    { x: h.x - d.x * 0.14 - d.y * 0.26, y: h.y - d.y * 0.14 + d.x * 0.26 },
    { x: h.x - d.x * 0.14 + d.y * 0.26, y: h.y - d.y * 0.14 - d.x * 0.26 });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export class CubeView {
  constructor(container, { onSelect = () => {}, onInteract = () => {} } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.onInteract = onInteract;
    this.disposed = false;
    this.removed = new Set();
    this.animations = new Map();
    this.pointers = new Map();
    this.velocity = { x: 0, y: 0 };
    this.zoom = 1;
    this.framingDistance = 7;
    this.raf = 0;
    this.lastTime = 0;
    this.highlighted = null;
    this.highlightTimer = 0;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.events = new AbortController();
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
    this.canvas.setAttribute('aria-label', '3D arrow puzzle. Drag to rotate, tap an arrow to release it. Arrow keys rotate; plus and minus zoom.');
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
    this.body = new THREE.Mesh(new RoundedBoxGeometry(2.035, 2.035, 2.035, 3, 0.035), new THREE.MeshStandardMaterial({ color: 0xf3f8ff, roughness: 0.46, metalness: 0.02 }));
    this.cube.add(this.body);
    this.faces = FACE_ROTATIONS.map((angles, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1024;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.73, metalness: 0, transparent: false });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.998, 1.998), material);
      plane.rotation.set(...angles);
      plane.position.copy(new THREE.Vector3(0, 0, 1.021).applyEuler(plane.rotation));
      plane.userData.face = index;
      this.cube.add(plane);
      return { canvas, ctx: canvas.getContext('2d'), texture, material, plane };
    });
    this.raycaster = new THREE.Raycaster();
    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
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
    this.camera.position.z = this.framingDistance / Math.min(this.camera.aspect, 1) / this.zoom;
    this.camera.updateProjectionMatrix();
    this.schedule();
  }

  setPuzzle(puzzle, removedSet = new Set()) {
    this.cancelAnimations();
    this.puzzle = puzzle;
    // Every dimension brings the cube a little closer; the asymptote leaves
    // space for its full bounding sphere at every rotation when zoom is reset.
    // Dimension 2 starts at 7 units, and large cubes approach 6.4 units (~9% growth).
    this.framingDistance = 7 - 0.6 * (1 - Math.exp(-Math.max(0, puzzle.size - 2) / 10));
    this.updateCamera();
    this.removed = new Set(removedSet);
    this.arrowById = new Map(puzzle.arrows.map(a => [a.id, a]));
    this.arrowsByFace = this.faces.map((_, face) => puzzle.arrows.filter(a => a.face === face));
    this.highlighted = null;
    clearTimeout(this.highlightTimer);
    const resolution = Math.min(2048, Math.max(768, puzzle.size * 64));
    for (const face of this.faces) face.canvas.width = face.canvas.height = resolution;
    this.drawFaces();
    this.schedule();
  }

  drawFaces(onlyFace = null) {
    if (!this.puzzle) return;
    const size = this.puzzle.size;
    this.faces.forEach((face, index) => {
      if (onlyFace !== null && index !== onlyFace) return;
      const { ctx, canvas, texture } = face, unit = canvas.width / size;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, '#f0f8fc'); gradient.addColorStop(1, '#dbeaf0');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const arrow of this.arrowsByFace[index]) {
        if (this.removed.has(arrow.id) || this.animations.has(arrow.id)) continue;
        const color = this.highlighted?.id === arrow.id ? (this.highlighted.type === 'blocked' ? BLOCKED : HINT) : INK;
        paintArrow(ctx, arrow.cells.map(p => ({ x: p.x + 0.5, y: p.y + 0.5 })), arrow.direction, color, unit);
      }
      texture.needsUpdate = true;
    });
    this.schedule();
  }

  pick(clientX, clientY) {
    if (!this.puzzle) return null;
    const rect = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.cube.updateMatrixWorld(true);
    this.raycaster.setFromCamera(mouse, this.camera);
    const hit = this.raycaster.intersectObjects(this.faces.map(f => f.plane), false)[0];
    if (!hit) return null;
    const size = this.puzzle.size;
    const p = { x: hit.uv.x * size - 0.5, y: (1 - hit.uv.y) * size - 0.5 };
    let best = null, bestDistance = 0.34;
    for (const arrow of this.arrowsByFace[hit.object.userData.face]) {
      if (this.removed.has(arrow.id) || this.animations.has(arrow.id)) continue;
      let distance = Infinity;
      for (let i = 1; i < arrow.cells.length; i++) distance = Math.min(distance, distanceToSegment(p, arrow.cells[i - 1], arrow.cells[i]));
      const head = arrow.cells.at(-1), d = arrow.direction;
      distance = Math.min(distance, distanceToSegment(p, { x: head.x - d.x * 0.3, y: head.y - d.y * 0.3 }, { x: head.x + d.x * 0.32, y: head.y + d.y * 0.32 }));
      if (distance < bestDistance) { bestDistance = distance; best = arrow.id; }
    }
    return best;
  }

  highlight(id, type = 'hint') {
    clearTimeout(this.highlightTimer);
    this.highlighted = { id, type };
    this.drawFaces();
    if (type === 'blocked') this.highlightTimer = setTimeout(() => this.clearHighlight(), 650);
  }

  clearHighlight() {
    clearTimeout(this.highlightTimer);
    if (this.disposed) return;
    this.highlighted = null;
    this.drawFaces();
  }

  removeArrow(id) {
    const arrow = this.arrowById?.get(id);
    if (!arrow || this.removed.has(id)) return Promise.resolve(false);
    if (this.animations.has(id)) return this.animations.get(id).promise;
    const face = this.faces[arrow.face];
    const material = new THREE.MeshBasicMaterial({ color: INK, side: THREE.DoubleSide, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(ribbonGeometry(slidingPath(arrow, 0), arrow.direction, this.puzzle.size), material);
    mesh.position.copy(face.plane.position).multiplyScalar(1.003);
    mesh.quaternion.copy(face.plane.quaternion);
    this.cube.add(mesh);
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    const head = arrow.cells.at(-1), direction = arrow.direction, size = this.puzzle.size;
    const edgeDistance = direction.x > 0 ? size - 0.5 - head.x : direction.x < 0 ? head.x + 0.5
      : direction.y > 0 ? size - 0.5 - head.y : head.y + 0.5;
    const clearDistance = Math.max(0.6, arrow.cells.length - 1) + edgeDistance + 0.35;
    const animation = { arrow, mesh, material, clearDistance, travel: clearDistance + size * 1.3,
      start: performance.now(), duration: this.reducedMotion ? 150 : Math.min(1200, 650 + arrow.cells.length * 9), resolve, promise };
    this.animations.set(id, animation);
    this.drawFaces(arrow.face);
    this.schedule();
    return promise;
  }

  cancelAnimations() {
    for (const animation of this.animations.values()) {
      this.cube.remove(animation.mesh);
      animation.mesh.geometry.dispose(); animation.material.dispose();
      animation.resolve(false);
    }
    this.animations.clear();
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

  // Arguments are radians around screen vertical and horizontal axes.
  rotateBy(dx, dy) {
    this.orientationTween = null;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(dy, dx, 0, 'XYZ'));
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
        if (this.pinchDistance > 1) this.zoom = clamp(this.zoom * distance / this.pinchDistance, 0.65, 2.2);
        this.pinchDistance = distance;
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
      if (!this.pointers.size) this.canvas.style.cursor = 'grab';
      if (this.pointers.size === 1) {
        const remaining = this.pointers.values().next().value;
        remaining.startX = remaining.x; remaining.startY = remaining.y; remaining.dragged = true;
      }
      if (event.type === 'pointerup' && !pointer.dragged) {
        const id = this.pick(event.clientX, event.clientY);
        if (id !== null) this.onSelect(id);
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
      const t = clamp((time - animation.start) / animation.duration, 0, 1);
      const distance = animation.travel * t * t;
      animation.mesh.geometry.dispose();
      animation.mesh.geometry = ribbonGeometry(slidingPath(animation.arrow, distance), animation.arrow.direction, this.puzzle.size);
      // Keep the whole arrow solid until its tail clears the edge. Only the
      // airborne portion fades, so long paths never dissolve while still on the board.
      animation.material.opacity = 1 - clamp((distance - animation.clearDistance) / (animation.travel - animation.clearDistance), 0, 1);
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
    this.body.geometry.dispose(); this.body.material.dispose();
    for (const face of this.faces) { face.plane.geometry.dispose(); face.material.dispose(); face.texture.dispose(); }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
