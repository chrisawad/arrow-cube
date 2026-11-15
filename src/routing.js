import { getGridSize, neighbor } from './cube-surface.js';
import { orientArrow } from './arrow-orientation.js';

export const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
export const surfaceCellKey = (cell, size) => cell.face * size * size + cell.y * size + cell.x;
const topologies = new WeakMap();

export const redirectorDirection = (marker, flipped = marker.flipped) => marker.flipping && flipped
  ? { x: -marker.direction.x || 0, y: -marker.direction.y || 0 } : { ...marker.direction };
export const redirectorStateKey = puzzle => (puzzle.redirectors || []).filter(marker => marker.flipping)
  .map(marker => marker.flipped ? '1' : '0').join('');
export const flippedRedirectorIds = puzzle => (puzzle.redirectors || [])
  .filter(marker => marker.flipping && marker.flipped).map(marker => marker.id);

export function restoreRedirectors(puzzle, ids = []) {
  const flipped = new Set(ids);
  for (const marker of puzzle.redirectors || []) if (marker.flipping) marker.flipped = flipped.has(marker.id);
}

/** Commit only a successful departure. Route previews never change the board. */
export function applyRedirectorFlips(puzzle, route) {
  const markers = new Map((puzzle.redirectors || []).map(marker => [marker.id, marker]));
  for (const event of route.flips || []) {
    const marker = markers.get(event.id);
    if (marker?.flipping) marker.flipped = !marker.flipped;
  }
}

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
 * Simulate flips locally, including repeat visits within a single move.
 * Loop detection includes the marker states; previews never mutate them.
 */
export function traceExitRoute(puzzle, arrow, reverse = false) {
  const size = getGridSize(puzzle), moving = orientArrow(arrow, size, reverse);
  const { wraps, redirects } = topology(puzzle), visited = new Set();
  const head = moving.cells.at(-1);
  let cell = { ...head, face: head.face ?? moving.face }, direction = { ...moving.direction }, step = 0;
  const nodes = [], transitions = [], turns = [], flips = [];
  const switching = (puzzle.redirectors || []).filter(marker => marker.flipping);
  const flipped = new Set(switching.filter(marker => marker.flipped).map(marker => marker.id));
  const result = (loop, exit, distance = step) => ({ nodes, transitions, turns, flips, distance, loop, exit });
  while (true) {
    const state = `${surfaceCellKey(cell, size)}:${direction.x},${direction.y}:${switching.map(marker => flipped.has(marker.id) ? '1' : '0').join('')}`;
    if (visited.has(state)) {
      nodes.push({ ...cell, step, incoming: { ...direction }, direction: { ...direction } });
      return result(true, null);
    }
    visited.add(state);
    const marker = redirects.get(surfaceCellKey(cell, size));
    const incoming = direction;
    if (marker) {
      direction = redirectorDirection(marker, flipped.has(marker.id));
      if (direction.x !== incoming.x || direction.y !== incoming.y) {
        turns.push({ id: marker.id, at: step, from: incoming, to: direction, cell: { ...cell } });
      }
      if (marker.flipping) {
        const next = !flipped.has(marker.id);
        if (next) flipped.add(marker.id); else flipped.delete(marker.id);
        flips.push({ id: marker.id, at: step, face: marker.face, flipped: next });
      }
    }
    nodes.push({ ...cell, step, incoming: { ...incoming }, direction: { ...direction } });
    const x = cell.x + direction.x, y = cell.y + direction.y;
    if (x < 0 || y < 0 || x >= size || y >= size) {
      const next = neighbor(cell, direction, size), key = edgeKey(cell.face, next.cell.face);
      if (!wraps.has(key)) return result(false,
        { cell: { ...cell }, direction: { ...direction }, face: cell.face }, step + 0.5);
      transitions.push({ edge: key, at: step + 0.5, from: cell.face, to: next.cell.face });
      cell = next.cell; direction = next.direction;
    } else cell = { face: cell.face, x, y };
    step++;
  }
}
