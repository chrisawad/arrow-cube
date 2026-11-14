import { getGridSizeForVersion, neighbor } from './cube-surface.js';
import { cubeEdges, edgeKey, surfaceCellKey } from './routing.js';

const DIRECTIONS = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];
const directionIndex = direction => direction.x < 0 ? 0 : direction.x > 0 ? 1 : direction.y < 0 ? 2 : 3;
function shuffle(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function pick(values, weights, random) {
  let choice = random() * weights.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < values.length; i++) if ((choice -= weights[i]) <= 0) return values[i];
  return values.at(-1);
}

class Frontier {
  constructor(count) { this.values = new Float64Array(count); this.tree = new Float64Array(count + 1); this.total = 0; this.count = 0; }
  set(index, value) {
    const previous = this.values[index], change = value - previous;
    if (change === 0) return;
    this.count += Number(value > 0) - Number(previous > 0);
    this.values[index] = value; this.total += change;
    for (let i = index + 1; i < this.tree.length; i += i & -i) this.tree[i] += change;
  }
  pick(random) {
    let value = random() * this.total, index = 0, bit = 1;
    while (bit * 2 < this.tree.length) bit *= 2;
    for (; bit; bit >>= 1) {
      const next = index + bit;
      if (next < this.tree.length && this.tree[next] <= value) { value -= this.tree[next]; index = next; }
    }
    return Math.min(index, this.values.length - 1);
  }
}

/**
 * Carve in removal order against the actual flow field. A candidate head's
 * entire future route must already be empty; its body grows only through
 * occupied cells. This proves the recorded solution even across many turns.
 */
export function buildFeaturePuzzle(size, seed, seededRandom, attempt = 0) {
  const random = seededRandom(`${seed}:flow-carve:${attempt}`), gridSize = getGridSizeForVersion(size, 11);
  const area = gridSize ** 2, total = 6 * area, states = total * 4;
  const cellOf = index => ({ face: Math.floor(index / area), x: index % gridSize, y: Math.floor(index % area / gridSize) });
  const guaranteed = attempt >= 5;
  const wrapEdges = guaranteed ? [[0, 1], [2, 4], [3, 5]] : shuffle(cubeEdges(), random).slice(0, 3);
  const wraps = new Set(wrapEdges.map(edge => edgeKey(...edge)));
  const redirectors = [], markerMap = new Map(), faces = shuffle([0, 1, 2, 3, 4, 5], random);
  const guaranteedState = surfaceCellKey({ face: 0, x: gridSize - 2, y: 1 }, gridSize) * 4 + 1;
  const guaranteedCorridor = new Set([
    ...Array.from({ length: gridSize }, (_, x) => ({ face: 0, x, y: 1 })),
    { face: 1, x: 0, y: 1 }, ...Array.from({ length: gridSize - 1 }, (_, i) => ({ face: 1, x: 1, y: i + 1 })),
  ].map(cell => surfaceCellKey(cell, gridSize)));
  const markerCount = Math.min(18, Math.max(2, Math.round(size * 0.8)));
  while (redirectors.length < markerCount) {
    const marker = guaranteed && redirectors.length === 0
      ? { id: 0, face: 1, x: 1, y: 1, direction: { x: 0, y: 1 } }
      : { id: redirectors.length, face: faces[redirectors.length % 6],
      x: 1 + Math.floor(random() * (gridSize - 2)), y: 1 + Math.floor(random() * (gridSize - 2)),
      direction: { ...DIRECTIONS[Math.floor(random() * 4)] } };
    const key = surfaceCellKey(marker, gridSize);
    if (markerMap.has(key) || (guaranteed && marker.id > 0 && guaranteedCorridor.has(key))) continue;
    redirectors.push(marker); markerMap.set(key, marker);
  }
  const remaining = new Uint8Array(total).fill(1);
  for (const key of markerMap.keys()) remaining[key] = 0;
  const adjacent = new Int32Array(states), transported = new Uint8Array(states), successor = new Int32Array(states);
  const firstPred = new Int32Array(states).fill(-1), nextPred = new Int32Array(states).fill(-1), localFeatures = new Uint8Array(states);
  for (let index = 0; index < total; index++) {
    const cell = cellOf(index), marker = markerMap.get(index);
    for (let d = 0; d < 4; d++) {
      const state = index * 4 + d, direction = DIRECTIONS[d];
      const x = cell.x + direction.x, y = cell.y + direction.y;
      if (x >= 0 && y >= 0 && x < gridSize && y < gridSize) {
        adjacent[state] = cell.face * area + y * gridSize + x; transported[state] = d;
      } else {
        const next = neighbor(cell, direction, gridSize);
        adjacent[state] = surfaceCellKey(next.cell, gridSize); transported[state] = directionIndex(next.direction);
      }
    }
    for (let d = 0; d < 4; d++) {
      const state = index * 4 + d, out = marker ? directionIndex(marker.direction) : d;
      const next = adjacent[index * 4 + out], nextFace = Math.floor(next / area);
      successor[state] = nextFace !== cell.face && !wraps.has(edgeKey(cell.face, nextFace))
        ? -1 : next * 4 + transported[index * 4 + out];
      localFeatures[state] = (marker ? 1 : 0) | (nextFace !== cell.face && successor[state] >= 0 ? 2 : 0);
      if (successor[state] >= 0) {
        nextPred[state] = firstPred[successor[state]]; firstPred[successor[state]] = state;
      }
    }
  }
  const ranks = new Int32Array(states).fill(-1), visiting = new Uint8Array(states), featureMask = new Uint8Array(states);
  for (let state = 0; state < states; state++) {
    if (ranks[state] !== -1) continue;
    const path = [];
    let cursor = state;
    while (cursor >= 0 && ranks[cursor] === -1 && !visiting[cursor]) {
      visiting[cursor] = 1; path.push(cursor); cursor = successor[cursor];
    }
    let depth = cursor < 0 ? -1 : ranks[cursor];
    if (cursor >= 0 && depth === -1) depth = -2;
    for (let i = path.length - 1; i >= 0; i--) {
      const current = path[i];
      ranks[current] = depth === -2 ? -2 : ++depth;
      featureMask[current] = localFeatures[current] | (successor[current] >= 0 ? featureMask[successor[current]] : 0);
    }
  }
  // Reserve one short body until a head using a redirect becomes available.
  // Otherwise a large neighboring tail could consume every useful approach.
  const candidateStates = [];
  for (let state = 0; state < states; state++) if (remaining[Math.floor(state / 4)] && ranks[state] >= 0 && (featureMask[state] & 1)) candidateStates.push(state);
  const ordered = guaranteed ? [guaranteedState] : shuffle(candidateStates, random).sort((a, b) => Number(featureMask[b] === 3) - Number(featureMask[a] === 3));
  const protectedCells = new Set();
  let protectedState = -1;
  for (const state of ordered) {
    const head = Math.floor(state / 4), back = (state % 4) ^ 1, neck = adjacent[head * 4 + back];
    const tail = adjacent[neck * 4 + transported[head * 4 + back]], body = new Set([head, neck, tail]);
    if (body.size !== 3 || !remaining[neck] || !remaining[tail]) continue;
    let cursor = successor[state], overlaps = false;
    while (cursor >= 0) {
      if (body.has(Math.floor(cursor / 4))) { overlaps = true; break; }
      cursor = successor[cursor];
    }
    if (overlaps) continue;
    protectedState = state;
    for (const cell of body) protectedCells.add(cell);
    break;
  }
  const clear = new Uint8Array(states), frontier = new Frontier(states);
  function refresh(state) {
    const index = Math.floor(state / 4), out = successor[state];
    if (!remaining[index] || (protectedCells.has(index) && state !== protectedState) || (out >= 0 && !clear[out])) { frontier.set(state, 0); return; }
    const behind = adjacent[index * 4 + ((state % 4) ^ 1)];
    const depth = Math.min(gridSize * 4, ranks[state]);
    frontier.set(state, (1 + depth * depth) * (remaining[behind] && (!protectedCells.has(behind) || state === protectedState) ? 12 : 0.15)
      * (featureMask[state] & 1 ? 5 : 1));
  }
  function propagate(queue, update) {
    for (let i = 0; i < queue.length; i++) {
      for (let pred = firstPred[queue[i]]; pred >= 0; pred = nextPred[pred]) {
        if (remaining[Math.floor(pred / 4)]) { if (update) refresh(pred); }
        else if (!clear[pred]) { clear[pred] = 1; queue.push(pred); }
      }
    }
  }
  const initial = [];
  for (let state = 0; state < states; state++) if (!remaining[Math.floor(state / 4)] && successor[state] < 0) {
    clear[state] = 1; initial.push(state);
  }
  propagate(initial, false);
  for (let state = 0; state < states; state++) refresh(state);
  const carved = [];
  while (frontier.count > 0) {
    const state = frontier.pick(random), head = Math.floor(state / 4), headDirection = state % 4;
    if (!remaining[head] || !frontier.values[state]) throw new Error('Invalid flow frontier candidate');
    if (state === protectedState) {
      const released = [...protectedCells]; protectedCells.clear();
      for (const cell of released) for (let d = 0; d < 4; d++) refresh(cell * 4 + d);
    }
    const path = [head]; remaining[head] = 0;
    const behind = adjacent[head * 4 + (headDirection ^ 1)];
    if (remaining[behind] && !protectedCells.has(behind)) { path.push(behind); remaining[behind] = 0; }
    const fixedAnchor = guaranteed && state === guaranteedState;
    if (fixedAnchor) {
      const tail = adjacent[behind * 4 + transported[head * 4 + (headDirection ^ 1)]];
      path.push(tail); remaining[tail] = 0;
    }
    const roll = random(), target = Math.min(75, roll < 0.48 ? 6 + Math.floor(random() * 11)
      : roll < 0.78 ? 20 + Math.floor(random() * 21) : 48 + Math.floor(random() * 28));
    if (path.length > 1 && !fixedAnchor) {
      const frames = [], headings = [headDirection ^ 1, transported[head * 4 + (headDirection ^ 1)]];
      let best = [...path], visits = 0;
      const rewind = () => { remaining[path.pop()] = 1; headings.pop(); };
      while (path.length >= 2 && visits++ < 128 + target * 12) {
        if (path.length > best.length) best = [...path];
        if (path.length >= target) break;
        const depth = path.length, last = path.at(-1);
        let frame = frames[depth];
        if (!frame) {
          frame = { choices: [], weights: [] };
          for (let d = 0; d < 4; d++) {
            const next = adjacent[last * 4 + d];
            if (!remaining[next] || protectedCells.has(next)) continue;
            let onward = 0;
            for (let nextD = 0; nextD < 4; nextD++) onward += remaining[adjacent[next * 4 + nextD]];
            frame.choices.push(d);
            frame.weights.push((Math.floor(last / area) !== Math.floor(next / area) ? 5 : 1)
              * (d === headings.at(-1) ? 1 : 1.8) * (onward ? 1 / Math.sqrt(onward) : 0.25));
          }
          frames[depth] = frame;
        }
        if (!frame.choices.length) {
          frames[depth] = undefined;
          if (depth === 2) break;
          rewind(); continue;
        }
        const d = pick(frame.choices, frame.weights, random), choice = frame.choices.indexOf(d);
        frame.choices.splice(choice, 1); frame.weights.splice(choice, 1);
        const next = adjacent[last * 4 + d];
        path.push(next); remaining[next] = 0; headings.push(transported[last * 4 + d]);
      }
      if (path.length > best.length) best = [...path];
      while (path.length > 2) rewind();
      for (const index of best.slice(2)) { path.push(index); remaining[index] = 0; }
    }
    const queue = [];
    for (const index of path) {
      for (let d = 0; d < 4; d++) {
        const own = index * 4 + d;
        refresh(own);
        if (!clear[own] && (successor[own] < 0 || clear[successor[own]])) { clear[own] = 1; queue.push(own); }
        refresh(adjacent[own] * 4 + transported[own]);
      }
    }
    propagate(queue, true);
    carved.push({ id: carved.length, face: Math.floor(head / area), direction: { ...DIRECTIONS[headDirection] }, cells: path.reverse().map(cellOf), featureHead: featureMask[state] > 0, fixedAnchor });
  }
  // Prefix joins preserve the receiving head's proof, because a later path's
  // cells were still occupied when that earlier head was chosen.
  const owner = new Int32Array(total).fill(-1);
  for (const arrow of carved) for (const cell of arrow.cells) owner[surfaceCellKey(cell, gridSize)] = arrow.id;
  function join(shortOnly) {
    for (let id = carved.length - 1; id >= 0; id--) {
      const source = carved[id];
      if (!source.cells.length || (source.featureHead && source.cells.length >= 3) || (shortOnly && source.cells.length >= 5)) continue;
      const choices = [], weights = [], roll = random();
      const limit = shortOnly ? 75 : Math.min(75, roll < 0.35 ? 20 + Math.floor(random() * 13)
        : roll < 0.7 ? 40 + Math.floor(random() * 25) : 72 + Math.floor(random() * 4));
      for (const endpoint of source.cells.length === 1 ? [0] : [0, source.cells.length - 1]) {
        const end = source.cells[endpoint], index = surfaceCellKey(end, gridSize);
        for (let d = 0; d < 4; d++) {
          const next = adjacent[index * 4 + d], recipientId = owner[next], recipient = carved[recipientId];
          if (recipientId < 0 || recipientId >= id || !recipient.cells.length || recipient.fixedAnchor
            || surfaceCellKey(recipient.cells[0], gridSize) !== next || source.cells.length + recipient.cells.length > limit) continue;
          if (recipient.cells.length === 1 && adjacent[next * 4 + (directionIndex(recipient.direction) ^ 1)] !== index) continue;
          choices.push({ recipient, reverse: endpoint === 0 });
          weights.push((end.face !== recipient.cells[0].face ? 3 : 1) * (1 + recipient.cells.length / 12));
        }
      }
      if (!choices.length) continue;
      const { recipient, reverse } = pick(choices, weights, random), prefix = reverse ? [...source.cells].reverse() : source.cells;
      recipient.cells.unshift(...prefix);
      for (const cell of prefix) owner[surfaceCellKey(cell, gridSize)] = recipient.id;
      source.cells = [];
    }
  }
  join(true); join(false);
  const arrows = carved.filter(arrow => arrow.cells.length >= 3).map(({ featureHead, fixedAnchor, ...arrow }, id) => ({ ...arrow, id }));
  return { size, gridSize, seed, generatorVersion: 11, wrapEdges, redirectors, arrows, solution: arrows.map(arrow => arrow.id) };
}
