/** Face-local x points right, y points down, matching the renderer's planes. */
export const FACE_BASIS = Object.freeze([
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] },
  { normal: [1, 0, 0], u: [0, 0, -1], v: [0, -1, 0] },
  { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0] },
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, -1, 0] },
  { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] },
]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clean = value => value === 0 ? 0 : value;
/** Seed versions fix their lane counts independently of the displayed level. */
export const getGridSizeForVersion = (size, generatorVersion) => generatorVersion >= 6
  ? Math.max(4, Math.round(size * 1.6)) : generatorVersion >= 3 ? size * 2 : size;
export const getGridSize = puzzle => puzzle.gridSize ?? puzzle.size;

/** Cell centers on a unit cube with half-extent 1. Accepts fractional x/y. */
export function cellToWorld(cell, gridSize, offset = 0) {
  const { normal, u, v } = FACE_BASIS[cell.face];
  const x = (cell.x + 0.5) * 2 / gridSize - 1;
  const y = (cell.y + 0.5) * 2 / gridSize - 1;
  const values = normal.map((n, i) => n * (1 + offset) + u[i] * x + v[i] * y);
  return { x: values[0], y: values[1], z: values[2] };
}

/** One grid step, folding the direction 90 degrees when crossing a cube edge. */
export function neighbor(cell, direction, gridSize) {
  const x = cell.x + direction.x, y = cell.y + direction.y;
  if (x >= 0 && y >= 0 && x < gridSize && y < gridSize) {
    return { cell: { face: cell.face, x, y }, direction: { ...direction } };
  }
  const basis = FACE_BASIS[cell.face];
  const nextNormal = basis.u.map((value, i) => value * direction.x + basis.v[i] * direction.y);
  const face = FACE_BASIS.findIndex(other => dot(other.normal, nextNormal) === 1);
  const next = FACE_BASIS[face];
  const edge = cellToWorld({ face: cell.face, x: cell.x + direction.x * 0.5, y: cell.y + direction.y * 0.5 }, gridSize);
  const position = [edge.x, edge.y, edge.z].map((value, i) => value - basis.normal[i] / gridSize);
  const forward = basis.normal.map(value => -value);
  return {
    cell: { face, x: clean(Math.round((dot(position, next.u) + 1) * gridSize / 2 - 0.5)),
      y: clean(Math.round((dot(position, next.v) + 1) * gridSize / 2 - 0.5)) },
    direction: { x: clean(dot(forward, next.u)), y: clean(dot(forward, next.v)) },
  };
}

/** Departure direction in the first cell's coordinate system. Cells must neighbor. */
export function directionBetween(from, to, gridSize) {
  let direction;
  if (from.face === to.face) direction = { x: to.x - from.x, y: to.y - from.y };
  else {
    const basis = FACE_BASIS[from.face], destinationNormal = FACE_BASIS[to.face].normal;
    direction = { x: clean(dot(destinationNormal, basis.u)), y: clean(dot(destinationNormal, basis.v)) };
  }
  if (Math.abs(direction.x) + Math.abs(direction.y) !== 1) throw new RangeError('Cells are not surface neighbors.');
  const actual = neighbor(from, direction, gridSize).cell;
  if (actual.face !== to.face || actual.x !== to.x || actual.y !== to.y) throw new RangeError('Cells are not surface neighbors.');
  return direction;
}

/** Shared crease point for adjacent cells on different faces. */
export function seamPoint(from, to, gridSize, offset = 0) {
  if (from.face === to.face) throw new RangeError('A seam needs two different faces.');
  const direction = directionBetween(from, to, gridSize);
  const point = cellToWorld({ face: from.face, x: from.x + direction.x * 0.5, y: from.y + direction.y * 0.5 }, gridSize);
  const a = FACE_BASIS[from.face].normal, b = FACE_BASIS[to.face].normal;
  return { x: point.x + (a[0] + b[0]) * offset, y: point.y + (a[1] + b[1]) * offset, z: point.z + (a[2] + b[2]) * offset };
}
