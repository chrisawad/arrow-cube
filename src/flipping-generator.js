import { applyRedirectorFlips, restoreRedirectors, surfaceCellKey } from './routing.js';

/**
 * A common removal order must work in EVERY switch configuration. Each arrow
 * may use either endpoint, but every state needs a clear choice after earlier
 * arrows are gone. This stronger proof stays valid after arbitrary legal moves:
 * the earliest remaining arrow in the order can always leave, whatever flipped.
 * Limit the number of switches so exhaustive state certification stays cheap.
 */
function certify(puzzle, getMove) {
  const switches = puzzle.redirectors.filter(marker => marker.flipping);
  const variants = Array.from({ length: 2 ** switches.length }, (_, mask) => {
    const variant = { ...puzzle, redirectors: puzzle.redirectors.map(marker => ({ ...marker })) };
    restoreRedirectors(variant, switches.filter((_, i) => mask & (1 << i)).map(marker => marker.id));
    return variant;
  });
  const records = [];
  for (const arrow of puzzle.arrows) {
    const states = [];
    for (const variant of variants) {
      const choices = (arrow.bidirectional ? [false, true] : [false])
        .map(reverse => getMove(variant, arrow.id, new Set(), reverse))
        .filter(info => !info.selfBlocked && !info.route.loop);
      if (!choices.length) return null;
      states.push(choices);
    }
    records.push({ arrow, states });
  }
  const removed = new Set(), order = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const { arrow, states } of records) {
      if (removed.has(arrow.id)) continue;
      if (!states.every(choices => choices.some(info => [...info.dependencies].every(id => removed.has(id))))) continue;
      removed.add(arrow.id); order.push(arrow.id); changed = true;
    }
  }
  if (removed.size !== puzzle.arrows.length) return null;

  // Replay the actual flips to record concrete endpoint choices and prove that
  // the markers are useful in a real solution, not just a hypothetical route.
  const live = { ...puzzle, redirectors: puzzle.redirectors.map(marker => ({ ...marker })) };
  removed.clear();
  const moves = [], used = new Set(), usedSwitches = new Set(), usedEdges = new Set();
  for (const id of order) {
    let info = getMove(live, id, removed, false);
    if (!info.canExit) info = getMove(live, id, removed, true);
    if (!info?.canExit) return null;
    for (const turn of info.route.turns) used.add(turn.id);
    for (const flip of info.route.flips) usedSwitches.add(flip.id);
    for (const edge of info.route.transitions) usedEdges.add(edge.edge);
    applyRedirectorFlips(live, info.route);
    removed.add(id); moves.push({ id, reverse: info.reverse });
  }
  if (switches.some(marker => !usedSwitches.has(marker.id))) return null;
  if (!usedEdges.size) return null;
  if (puzzle.redirectors.some(marker => !used.has(marker.id))) return null;
  return { ...puzzle, solution: order, solutionMoves: moves };
}

export function addFlippingRedirectors(puzzle, getMove, random) {
  const candidates = puzzle.redirectors.map(marker => ({ marker, score: random() }));
  candidates.sort((a, b) => a.score - b.score);
  const target = Math.min(2, Math.max(1, Math.floor(puzzle.size / 6)));
  let result = puzzle, count = 0;
  for (const { marker } of candidates) {
    if (result.redirectors.filter(item => !item.flipping).length <= 1) break;
    const candidate = { ...result, redirectors: result.redirectors.map(item => item.id === marker.id
      ? { ...item, flipping: true, flipped: false } : item) };
    const certified = certify(candidate, getMove);
    if (!certified) continue;
    result = certified;
    if (++count >= target) break;
  }
  if (count) return result;

  // A sparse board may have only one useful blue marker. Try vacant cells on
  // existing exit routes; never cover a line or add an unreachable decoration.
  const occupied = new Set(puzzle.arrows.flatMap(arrow => arrow.cells.map(cell => surfaceCellKey(cell, puzzle.gridSize))));
  for (const marker of puzzle.redirectors) occupied.add(surfaceCellKey(marker, puzzle.gridSize));
  const gaps = new Map();
  for (const move of puzzle.solutionMoves) {
    const nodes = getMove(puzzle, move.id, new Set(), move.reverse).route.nodes;
    for (const cell of nodes.slice(1)) {
      const key = surfaceCellKey(cell, puzzle.gridSize);
      if (!occupied.has(key) && !gaps.has(key)) gaps.set(key, cell);
    }
  }
  const id = Math.max(-1, ...puzzle.redirectors.map(marker => marker.id)) + 1;
  for (const cell of [...gaps.values()].slice(0, 48)) {
    for (const direction of [{ x: -cell.direction.y, y: cell.direction.x }, { x: cell.direction.y, y: -cell.direction.x }]) {
      const marker = { id, face: cell.face, x: cell.x, y: cell.y, direction, flipping: true, flipped: false };
      const certified = certify({ ...puzzle, redirectors: [...puzzle.redirectors, marker] }, getMove);
      if (certified) return certified;
    }
  }
  return null;
}
