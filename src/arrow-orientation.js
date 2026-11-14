import { directionBetween } from './cube-surface.js';

/** Keep one arrow ID while choosing which endpoint leads the moving line. */
export function orientArrow(arrow, gridSize, reverse = false) {
  if (!reverse) return arrow;
  const cells = arrow.cells.map(cell => ({ ...cell, face: cell.face ?? arrow.face }));
  const inward = cells.length > 1
    ? directionBetween(cells[0], cells[1], gridSize)
    : arrow.direction;
  return { ...arrow, face: cells[0].face, cells: cells.reverse(),
    direction: { x: -inward.x || 0, y: -inward.y || 0 } };
}

/** Path distance, rather than screen position, defines the two clickable halves. */
export function reverseAtProgress(arrow, progress) {
  return Boolean(arrow.bidirectional && progress < (arrow.cells.length - 1) / 2);
}
