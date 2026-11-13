import { getBlockingArrow } from './engine.js';
import { directionBetween, getGridSize } from './cube-surface.js';

// Shared with the canvas and mesh renderer, in grid-cell units.
export const ARROW_SHAPE = Object.freeze({ radius: 0.095, tip: 0.32, base: 0.14, wing: 0.26, singletonStem: 0.4 });
const DENSE_ARROW_SHAPE = Object.freeze({ radius: 0.23688, tip: 0.44, base: 0.20, wing: 0.40, singletonStem: 0.25 });
export const arrowShape = puzzle => puzzle.generatorVersion >= 3 ? DENSE_ARROW_SHAPE : ARROW_SHAPE;

export function arrowHead(head, direction, shape = ARROW_SHAPE) {
  const { tip, base, wing } = shape;
  return [
    { x: head.x + direction.x * tip, y: head.y + direction.y * tip },
    { x: head.x - direction.x * base - direction.y * wing, y: head.y - direction.y * base + direction.x * wing },
    { x: head.x - direction.x * base + direction.y * wing, y: head.y - direction.y * base - direction.x * wing },
  ];
}

export function arrowFragments(arrow, size) {
  const cells = arrow.cells.map(cell => ({ ...cell, face: cell.face ?? arrow.face }));
  const fragments = [{ face: cells[0].face, points: [cells[0]], head: false }];
  for (let i = 1; i < cells.length; i++) {
    const previous = cells[i - 1], cell = cells[i];
    if (previous.face !== cell.face) {
      const out = directionBetween(previous, cell, size), back = directionBetween(cell, previous, size);
      fragments.at(-1).points.push({ x: previous.x + out.x * 0.5, y: previous.y + out.y * 0.5 });
      fragments.push({ face: cell.face, points: [{ x: cell.x + back.x * 0.5, y: cell.y + back.y * 0.5 }], head: false });
    }
    fragments.at(-1).points.push(cell);
  }
  fragments.at(-1).head = true;
  return fragments;
}

// Swept separating-axis test: how far a moving arrowhead travels before touching
// one convex piece of the obstacle. This includes opposing/perpendicular heads.
function contactDistance(moving, fixed, direction) {
  let enter = 0, exit = Infinity;
  for (const polygon of [moving, fixed]) {
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const axis = { x: a.y - b.y, y: b.x - a.x };
      const project = points => points.map(p => p.x * axis.x + p.y * axis.y);
      const m = project(moving), f = project(fixed);
      const low = Math.min(...f) - Math.max(...m), high = Math.max(...f) - Math.min(...m);
      const speed = direction.x * axis.x + direction.y * axis.y;
      if (Math.abs(speed) < 1e-10) {
        if (low > 1e-10 || high < -1e-10) return Infinity;
      } else {
        enter = Math.max(enter, Math.min(low / speed, high / speed));
        exit = Math.min(exit, Math.max(low / speed, high / speed));
        if (enter > exit + 1e-10) return Infinity;
      }
    }
  }
  return exit >= 0 ? enter : Infinity;
}

export function findArrowCollision(puzzle, arrow, removed = new Set()) {
  const blockerId = getBlockingArrow(puzzle, arrow.id, removed);
  if (blockerId === null) return null;
  const blocker = puzzle.arrows.find(candidate => candidate.id === blockerId);
  const shape = arrowShape(puzzle), radius = shape.radius, pieces = [];
  const headFace = arrow.cells.at(-1).face ?? arrow.face;
  for (const fragment of arrowFragments(blocker, getGridSize(puzzle))) {
    if (fragment.face !== headFace) continue;
    if (fragment.head) pieces.push(arrowHead(blocker.cells.at(-1), blocker.direction, shape));
    // Only the strands on the departing face can block its exit ray.
    const points = fragment.points.length === 1
      ? [{ x: fragment.points[0].x - blocker.direction.x * shape.singletonStem,
        y: fragment.points[0].y - blocker.direction.y * shape.singletonStem }, fragment.points[0]]
      : fragment.points;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!length) continue;
      const nx = -(b.y - a.y) / length * radius, ny = (b.x - a.x) / length * radius;
      pieces.push([{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny },
        { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }]);
    }
    for (const cell of points) {
      pieces.push(Array.from({ length: 32 }, (_, i) => ({
        x: cell.x + Math.cos(i * Math.PI / 16) * radius,
        y: cell.y + Math.sin(i * Math.PI / 16) * radius,
      })));
    }
  }
  const head = arrow.cells.at(-1), direction = arrow.direction;
  const moving = arrowHead(head, direction, shape);
  let distance = Infinity;
  for (const piece of pieces) {
    // A self-blocking path must collide with its forward loop, not its own head.
    if (blockerId === arrow.id && !piece.some(p => (p.x - head.x) * direction.x + (p.y - head.y) * direction.y > 0.5)) continue;
    distance = Math.min(distance, contactDistance(moving, piece, direction));
  }
  return Number.isFinite(distance) ? { blockerId, distance: Math.max(0, distance) } : null;
}

export function bumpTimings(distance, reducedMotion = false) {
  return reducedMotion
    ? { outbound: 80, hold: 150, rollback: 0 }
    : { outbound: Math.min(210, Math.round(120 + distance * 15)), hold: 35, rollback: 95 };
}

export function sampleBumpMotion(elapsed, distance, timings, reducedMotion = false, previouslyBlocked = false) {
  const { outbound, hold, rollback } = timings;
  const impacted = elapsed >= outbound;
  const complete = elapsed >= outbound + hold + rollback;
  let travel = 0;
  if (!reducedMotion && !complete) {
    if (!impacted) travel = distance * Math.pow(Math.max(0, elapsed) / outbound, 2);
    else if (elapsed < outbound + hold) travel = distance;
    else travel = distance * Math.pow(1 - (elapsed - outbound - hold) / rollback, 2);
  }
  return { distance: travel, impacted, complete, color: impacted || previouslyBlocked ? 'blocked' : 'ink' };
}
