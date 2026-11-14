import { getGridSize, neighbor } from './cube-surface.js';
import { orientArrow } from './arrow-orientation.js';

export const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
export const surfaceCellKey = (cell, size) => cell.face * size * size + cell.y * size + cell.x;
const topologies = new WeakMap();

function topology(puzzle) {
  let result = topologies.get(puzzle);
  if (!result) {
    const size = getGridSize(puzzle);
    result = { wraps: new Set((puzzle.wrapEdges || []).map(([a, b]) => edgeKey(a, b))),
      redirects: new Map((puzzle.redirectors || []).map(marker => [surfaceCellKey(marker, size), marker])) };
    topologies.set(puzzle, result);
  }
  return result;
}

/** The twelve physical edges, independent of which face is currently visible. */
export function cubeEdges() {
  const pairs = new Map();
  for (let face = 0; face < 6; face++) for (const direction of [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }]) {
    const cell = { face, x: direction.x < 0 ? 0 : 3, y: direction.y < 0 ? 0 : 3 };
    const next = neighbor(cell, direction, 4).cell;
    if (next.face !== face) pairs.set(edgeKey(face, next.face), [Math.min(face, next.face), Math.max(face, next.face)]);
  }
  return [...pairs.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/**
 * Follow a leading endpoint through any number of redirects and yellow edges.
 * Occupancy is deliberately separate: the route is fixed while other lines
 * disappear. Repeated cell/direction states identify loops without hanging.
 */
export function traceExitRoute(puzzle, arrow, reverse = false) {
  const size = getGridSize(puzzle), moving = orientArrow(arrow, size, reverse);
  const { wraps, redirects } = topology(puzzle), visited = new Set();
  const head = moving.cells.at(-1);
  let cell = { ...head, face: head.face ?? moving.face }, direction = { ...moving.direction }, step = 0;
  const nodes = [], transitions = [], turns = [];
  while (true) {
    const marker = redirects.get(surfaceCellKey(cell, size));
    const incoming = direction;
    if (marker && (marker.direction.x !== direction.x || marker.direction.y !== direction.y)) {
      direction = { ...marker.direction };
      turns.push({ id: marker.id, at: step, from: incoming, to: direction, cell: { ...cell } });
    }
    const state = surfaceCellKey(cell, size) * 4 + (direction.x < 0 ? 0 : direction.x > 0 ? 1 : direction.y < 0 ? 2 : 3);
    nodes.push({ ...cell, step, incoming: { ...incoming }, direction: { ...direction } });
    if (visited.has(state)) return { nodes, transitions, turns, distance: step, loop: true, exit: null };
    visited.add(state);
    const x = cell.x + direction.x, y = cell.y + direction.y;
    if (x < 0 || y < 0 || x >= size || y >= size) {
      const next = neighbor(cell, direction, size), key = edgeKey(cell.face, next.cell.face);
      if (!wraps.has(key)) return { nodes, transitions, turns, distance: step + 0.5, loop: false,
        exit: { cell: { ...cell }, direction: { ...direction }, face: cell.face } };
      transitions.push({ edge: key, at: step + 0.5, from: cell.face, to: next.cell.face });
      cell = next.cell; direction = next.direction;
    } else cell = { face: cell.face, x, y };
    step++;
  }
}
