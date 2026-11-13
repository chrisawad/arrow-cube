import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GENERATOR_VERSION, generatePuzzle, canRemove, getRemovable, getBlockingArrow, seededRandom } from '../src/engine.js';
import { FACE_BASIS, getGridSize, neighbor, directionBetween, cellToWorld, seamPoint } from '../src/cube-surface.js';

function validateGeometry(puzzle) {
  const gridSize = getGridSize(puzzle);
  const cells = new Set();
  const ids = new Set();
  for (const arrow of puzzle.arrows) {
    assert(!ids.has(arrow.id), 'arrow IDs are unique');
    ids.add(arrow.id);
    assert(arrow.face >= 0 && arrow.face < 6);
    assert(arrow.cells.length >= 1);
    assert.equal(Math.abs(arrow.direction.x) + Math.abs(arrow.direction.y), 1);
    assert(Number.isInteger(arrow.direction.x) && Number.isInteger(arrow.direction.y));
    for (let i = 0; i < arrow.cells.length; i++) {
      const { x, y } = arrow.cells[i];
      assert(Number.isInteger(x) && Number.isInteger(y));
      assert(x >= 0 && y >= 0 && x < gridSize && y < gridSize);
      const face = arrow.cells[i].face ?? arrow.face;
      const key = `${face}/${x}/${y}`;
      assert(!cells.has(key), `overlapping cell ${key}`);
      cells.add(key);
      if (i) {
        const before = { face: arrow.face, ...arrow.cells[i - 1] };
        assert.doesNotThrow(() => directionBetween(before, { face, x, y }, gridSize), 'successive cells must be surface neighbors');
      }
    }
    if (arrow.cells.length >= 2) {
      const head = { face: arrow.face, ...arrow.cells.at(-1) };
      const neck = { face: arrow.face, ...arrow.cells.at(-2) };
      assert.equal(arrow.face, head.face);
      const backwards = directionBetween(head, neck, gridSize);
      assert.deepEqual(arrow.direction, { x: -backwards.x || 0, y: -backwards.y || 0 });
    }
  }
  assert.equal(new Set(puzzle.solution).size, puzzle.arrows.length);
  assert.equal(puzzle.solution.length, puzzle.arrows.length);
  const removed = new Set();
  for (const id of puzzle.solution) {
    assert(canRemove(puzzle, id, removed), `certified solution blocked at arrow ${id}`);
    removed.add(id);
    assert(!canRemove(puzzle, id, removed), 'removed arrows cannot be played again');
  }
  assert.equal(getRemovable(puzzle, removed).length, 0);
  return cells.size / (6 * gridSize * gridSize);
}

test('same dimensions and seed reproduce exactly the same puzzle', () => {
  assert.equal(generatePuzzle(3, 42).generatorVersion, GENERATOR_VERSION);
  assert.deepEqual(generatePuzzle(8, 'saved-game-42'), generatePuzzle(8, 'saved-game-42'));
  assert.notDeepEqual(generatePuzzle(8, 'saved-game-42'), generatePuzzle(8, 'saved-game-43'));
});

test('all generated geometry and certified solutions are valid across levels and seeds', () => {
  let minimumCoverage = 1;
  for (const size of [2, 3, 4, 5, 7, 10, 16, 24, 32, 40, 64]) {
    for (let seed = 0; seed < (size < 16 ? 32 : 6); seed++) {
      const coverage = validateGeometry(generatePuzzle(size, seed, 2));
      minimumCoverage = Math.min(minimumCoverage, coverage);
      assert.equal(coverage, 1, `size ${size}, seed ${seed}: every cell should contain an arrow`);
    }
  }
  console.log(`Lowest tested face-average coverage: ${(minimumCoverage * 100).toFixed(1)}%`);
});

test('arbitrary legal play orders never produce a deadlock', () => {
  for (let seed = 0; seed < 24; seed++) {
    const puzzle = generatePuzzle(10, seed);
    const random = seededRandom(`play-${seed}`);
    const removed = new Set();
    while (removed.size < puzzle.arrows.length) {
      const legal = getRemovable(puzzle, removed);
      assert(legal.length > 0, `deadlock after ${removed.size} moves`);
      const choice = legal[Math.floor(random() * legal.length)];
      removed.add(choice.id);
    }
  }
});

test('boards have meaningful dependencies, bends, and different lengths', () => {
  for (let seed = 0; seed < 16; seed++) {
    const puzzle = generatePuzzle(9, seed, 2);
    const lengths = new Set(puzzle.arrows.map(arrow => arrow.cells.length));
    const directions = new Set(puzzle.arrows.map(arrow => `${arrow.direction.x},${arrow.direction.y}`));
    assert(lengths.size >= 5);
    assert.equal(directions.size, 4);
    const bent = puzzle.arrows.filter(arrow => arrow.cells.some((cell, i, path) => i >= 2 &&
      (cell.x - path[i - 1].x !== path[i - 1].x - path[i - 2].x || cell.y - path[i - 1].y !== path[i - 1].y - path[i - 2].y)));
    assert(bent.length > puzzle.arrows.length * 0.22, 'short arrows must retain plenty of bent paths');
    assert(getRemovable(puzzle).length < puzzle.arrows.length * 0.25, 'most arrows should depend on other paths');
  }
});

test('dense boards contain substantially more arrows and fewer immediate moves than legacy boards', () => {
  for (const size of [3, 5, 8, 12]) {
    let oldCount = 0, newCount = 0, oldLegal = 0, newLegal = 0;
    for (let seed = 0; seed < 32; seed++) {
      const oldPuzzle = generatePuzzle(size, seed, 1);
      const newPuzzle = generatePuzzle(size, seed, 2);
      oldCount += oldPuzzle.arrows.length;
      newCount += newPuzzle.arrows.length;
      oldLegal += getRemovable(oldPuzzle).length;
      newLegal += getRemovable(newPuzzle).length;
    }
    assert(newCount >= oldCount * 1.7, `size ${size}: insufficient increase in paths`);
    assert(newLegal / newCount < oldLegal / oldCount * 0.7, `size ${size}: insufficient increase in dependencies`);
  }
});

test('version 1 regenerates existing saved boards byte-for-byte', () => {
  // Golden fingerprints retain the original cells, directions, IDs and solution
  // order. Persisted removed IDs remain meaningful after upgrading the app.
  const savedBoards = [
    [3, 1234, '3dc5cf342158848fa79957e9b746eb1b47006d934fc201279f1aba9b8887b82d'],
    [8, 'saved-game-42', '790d8e89564bb6a2e714762139a92466dcc1dff9b2e2f90246c3c0db9716d740'],
    [12, 7, 'da11b2e13bf532cea3e64c46a99f4d5e4433fec8598edfb94f3956b317f5180a'],
  ];
  for (const [size, seed, expectedHash] of savedBoards) {
    const puzzle = generatePuzzle(size, seed, 1);
    assert.equal(puzzle.generatorVersion, 1);
    assert(puzzle.arrows.every(arrow => arrow.cells.length >= 2));
    validateGeometry(puzzle);
    const hash = createHash('sha256').update(JSON.stringify({ arrows: puzzle.arrows, solution: puzzle.solution })).digest('hex');
    assert.equal(hash, expectedHash);
  }
});

test('version 2 regenerates existing dense saved boards byte-for-byte', () => {
  const savedBoards = [
    [3, 1234, 'bb95bfb8ce94024be81f22525b2a52b6d3c9a78c26112277c67544a770237c15'],
    [8, 'saved-game-42', 'eac6be03bd98ccdc31267de055f895a56bbad51b270b424abafce5b3cd362c14'],
    [12, 7, 'efba06fb10d279df176f3dab8cf8f1ba74033e9d1eabfbecfe3aa93930008094'],
  ];
  for (const [size, seed, expectedHash] of savedBoards) {
    const puzzle = generatePuzzle(size, seed, 2);
    assert.equal(puzzle.generatorVersion, 2);
    const hash = createHash('sha256').update(JSON.stringify({ arrows: puzzle.arrows, solution: puzzle.solution })).digest('hex');
    assert.equal(hash, expectedHash);
  }
});

test('version 3 regenerates existing wrapped saved boards byte-for-byte', () => {
  const savedBoards = [
    [3, 1234, '19c3907f6f9be5d012799f7f6deb4956747ccc2596747dce1c7d76748a912e2a'],
    [8, 'saved-game-42', 'b09b264962d7f3db53585a059f726bb4be7379c3d87b7dcbcda073ff379b28d6'],
    [12, 7, '6666c9b91cf84e7505734417a5d8bfe1d892dd484f1280b5b7385ee0b95f027e'],
  ];
  for (const [size, seed, expectedHash] of savedBoards) {
    const puzzle = generatePuzzle(size, seed, 3);
    const hash = createHash('sha256').update(JSON.stringify({ arrows: puzzle.arrows, solution: puzzle.solution })).digest('hex');
    assert.equal(hash, expectedHash);
  }
});

test('version 4 regenerates existing five-cell saved boards byte-for-byte', () => {
  const savedBoards = [
    [3, 1234, '81ab1396c3f4faaa64a772d7d629b3d58e2a4fea01dee646eb87e854e1534e72'],
    [8, 'saved-game-42', '748eda1fdd0078900eb53ebf663764750be291553703f9274f4a79c15b9b5e70'],
    [12, 7, '1586441edbc470c732f9df23b3c4f52cce94ed2914767c5e61e72846af6e4dce'],
  ];
  for (const [size, seed, expectedHash] of savedBoards) {
    const puzzle = generatePuzzle(size, seed, 4);
    const hash = createHash('sha256').update(JSON.stringify({ arrows: puzzle.arrows, solution: puzzle.solution })).digest('hex');
    assert.equal(hash, expectedHash);
  }
});

test('version 5 regenerates existing random saved boards byte-for-byte', () => {
  const savedBoards = [
    [3, 1234, '7227e09d1cd94f57f62686a4770bdd1b5dec2579640129d28bc6a5f012282bdf'],
    [8, 'saved-game-42', 'e9f298899751d3152de8316613770b6a56d4e8ee4604525ee47ee69bd41bc6ec'],
    [12, 7, '4db12e5668f88ebd136f1bde1134bf19ef9c796ac2881cdc08f094dbf7bbfe43'],
  ];
  for (const [size, seed, expectedHash] of savedBoards) {
    const puzzle = generatePuzzle(size, seed, 5);
    const hash = createHash('sha256').update(JSON.stringify({ arrows: puzzle.arrows, solution: puzzle.solution })).digest('hex');
    assert.equal(hash, expectedHash);
  }
});

test('version 6 regenerates existing roomier saved boards byte-for-byte', () => {
  const savedBoards = [
    [3, 1234, '51b255ca9e40da75c5161e48680d685f2fc580c335deda4a0b423366b6228284'],
    [8, 'saved-game-42', '87c85a3752481553acbb3ae1f0544007faa54bad9e102d1bfcee30607d8bb654'],
    [12, 7, '585b1f8cddb6c0837e7b5e2ad1805e859ef393b1535c77a6e8b3289b5d8dd45a'],
  ];
  for (const [size, seed, expectedHash] of savedBoards) {
    const puzzle = generatePuzzle(size, seed, 6);
    const hash = createHash('sha256').update(JSON.stringify({ arrows: puzzle.arrows, solution: puzzle.solution })).digest('hex');
    assert.equal(hash, expectedHash);
  }
});

test('version 7 regenerates existing extended saved boards byte-for-byte', () => {
  const savedBoards = [
    [3, 1234, 'e6d019cb76acc71c4922dea25a689fd87eeb8a07582651c6cb1fdce627fa8c31'],
    [8, 'saved-game-42', '56b3b9d9daaa1a662a54aa4e6b11cd6abd426b69f7fb182924995bedf87a0e7b'],
    [12, 7, '35951bc1226ec505d5d3960195cd9aa9b462dfd0d55a7ea8901544d53b3eb4d7'],
  ];
  for (const [size, seed, expectedHash] of savedBoards) {
    const puzzle = generatePuzzle(size, seed, 7);
    const hash = createHash('sha256').update(JSON.stringify({ arrows: puzzle.arrows, solution: puzzle.solution })).digest('hex');
    assert.equal(hash, expectedHash);
  }
});

test('version 8 regenerates existing 72-cell saved boards byte-for-byte', () => {
  const savedBoards = [
    [3, 1234, 'e6d019cb76acc71c4922dea25a689fd87eeb8a07582651c6cb1fdce627fa8c31'],
    [8, 'saved-game-42', '96b2c1c37e7953677a28b9296cfd63607a529e6ea1351903e830faa9a7708b0b'],
    [12, 7, '1788022545212ed189ea5ce6f262597d1ca35a33a7656e3013aed892fb95ba99'],
  ];
  for (const [size, seed, expectedHash] of savedBoards) {
    const puzzle = generatePuzzle(size, seed, 8);
    const hash = createHash('sha256').update(JSON.stringify({ arrows: puzzle.arrows, solution: puzzle.solution })).digest('hex');
    assert.equal(hash, expectedHash);
  }
});

test('version 9 regenerates existing 50-cell saved boards byte-for-byte', () => {
  const savedBoards = [
    [3, 1234, 'e6d019cb76acc71c4922dea25a689fd87eeb8a07582651c6cb1fdce627fa8c31'],
    [8, 'saved-game-42', '902dc0f583342781b73e0724359ca066da757fbd10970ce9022234871d00cbaf'],
    [12, 7, 'f57e3936e10eb91a47d0df5a41fb1d6b4f0b25012080bdd92a427e812b41a41d'],
  ];
  for (const [size, seed, expectedHash] of savedBoards) {
    const puzzle = generatePuzzle(size, seed, 9);
    const hash = createHash('sha256').update(JSON.stringify({ arrows: puzzle.arrows, solution: puzzle.solution })).digest('hex');
    assert.equal(hash, expectedHash);
  }
});

test('cube topology has reciprocal steps and matching physical crease points', () => {
  assert.equal(FACE_BASIS.length, 6);
  const directions = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];
  for (const size of [2, 3, 8, 32]) {
    for (let face = 0; face < 6; face++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const cell = { face, x, y };
      for (const direction of directions) {
        const next = neighbor(cell, direction, size);
        assert(next.cell.x >= 0 && next.cell.y >= 0 && next.cell.x < size && next.cell.y < size);
        const back = neighbor(next.cell, { x: -next.direction.x, y: -next.direction.y }, size);
        assert.deepEqual(back.cell, cell);
        assert.deepEqual(directionBetween(cell, next.cell, size), direction);
        if (cell.face !== next.cell.face) {
          const a = seamPoint(cell, next.cell, size, 0.02), b = seamPoint(next.cell, cell, size, 0.02);
          for (const key of ['x', 'y', 'z']) assert(Math.abs(a[key] - b[key]) < 1e-10);
          const aCenter = cellToWorld(cell, size), bCenter = cellToWorld(next.cell, size);
          const seam = seamPoint(cell, next.cell, size);
          for (const center of [aCenter, bCenter]) assert(Math.abs(Math.hypot(center.x - seam.x, center.y - seam.y, center.z - seam.z) - 1 / size) < 1e-10);
        }
      }
    }
  }
});

test('wrapped boards fill doubled surface grids and preserve certified solutions', () => {
  for (const size of [2, 3, 5, 6, 8, 12, 24, 64]) {
    for (let seed = 0; seed < (size <= 12 ? 24 : 3); seed++) {
      const puzzle = generatePuzzle(size, seed, 3);
      assert.equal(puzzle.gridSize, size * 2);
      assert.equal(puzzle.generatorVersion, 3);
      assert.equal(validateGeometry(puzzle), 1);
    }
  }
});

test('wrapped levels have long varied paths, strong dependencies, and crossings on every cube edge', () => {
  for (const size of [5, 6, 8]) for (let seed = 0; seed < 24; seed++) {
    const puzzle = generatePuzzle(size, seed, 3), edges = new Set();
    let wrapped = 0, threeFaces = 0, singleton = 0;
    const lengths = new Set();
    for (const arrow of puzzle.arrows) {
      const faces = new Set(arrow.cells.map(cell => cell.face));
      wrapped += faces.size > 1; threeFaces += faces.size > 2;
      singleton += arrow.cells.length === 1; lengths.add(arrow.cells.length);
      arrow.cells.forEach((cell, i) => {
        if (i && cell.face !== arrow.cells[i - 1].face) edges.add([cell.face, arrow.cells[i - 1].face].sort().join('/'));
      });
    }
    assert(wrapped / puzzle.arrows.length > 0.2);
    assert(threeFaces >= 1);
    assert(singleton / puzzle.arrows.length < 0.25);
    assert(lengths.size >= 8);
    assert.equal(edges.size, 12, `level ${size}, seed ${seed}: every cube edge should carry a line`);
    assert(getRemovable(puzzle).length / puzzle.arrows.length < 0.2, 'at least 80% of arrows begin blocked');
  }
});

test('arbitrary legal play never deadlocks a wrapped board', () => {
  for (let seed = 0; seed < 16; seed++) {
    const puzzle = generatePuzzle(6, seed, 3), random = seededRandom(`wrapped-play-${seed}`), removed = new Set();
    while (removed.size < puzzle.arrows.length) {
      const available = getRemovable(puzzle, removed);
      assert(available.length > 0);
      removed.add(available[Math.floor(random() * available.length)].id);
    }
  }
});

test('minimum-five-cell boards cover every surface cell and retain certified solutions', () => {
  for (const size of [2, 3, 4, 5, 6, 8, 12, 24, 32, 64]) {
    for (let seed = 0; seed < (size <= 4 ? 48 : size <= 12 ? 24 : 4); seed++) {
      const puzzle = generatePuzzle(size, seed, 4);
      assert.equal(puzzle.generatorVersion, 4);
      assert.equal(puzzle.gridSize, size * 2);
      assert(puzzle.arrows.every(arrow => arrow.cells.length >= 5 && arrow.cells.length <= 24), `level ${size}, seed ${seed}: lengths must stay within 5–24 cells`);
      assert.equal(validateGeometry(puzzle), 1, 'minimum length must never leave gaps');
    }
  }
});

test('minimum-five-cell boards keep wrapping, bends, length variety and blocked moves', () => {
  for (const size of [5, 6, 8, 12, 32, 64]) for (let seed = 0; seed < (size < 16 ? 24 : 2); seed++) {
    const puzzle = generatePuzzle(size, seed, 4);
    let wrapped = 0, bent = 0;
    const lengths = new Set();
    for (const arrow of puzzle.arrows) {
      wrapped += new Set(arrow.cells.map(cell => cell.face)).size > 1;
      lengths.add(arrow.cells.length);
      const turns = arrow.cells.some((cell, i, path) => {
        if (i < 2) return false;
        const previousDirection = directionBetween(path[i - 2], path[i - 1], puzzle.gridSize);
        const transported = neighbor(path[i - 2], previousDirection, puzzle.gridSize).direction;
        const direction = directionBetween(path[i - 1], cell, puzzle.gridSize);
        return direction.x !== transported.x || direction.y !== transported.y;
      });
      bent += turns;
    }
    assert(wrapped >= puzzle.gridSize, `level ${size}, seed ${seed}: too few wrapped paths`);
    assert(bent / puzzle.arrows.length > 0.3, 'tail transfers must create varied bends');
    assert(lengths.size >= 10);
    assert(getRemovable(puzzle).length / puzzle.arrows.length < 0.25, 'at least three quarters of arrows should depend on other moves');
  }
});

test('arbitrary legal play never deadlocks minimum-five-cell boards', () => {
  for (const size of [2, 3, 6, 12]) for (let seed = 0; seed < 12; seed++) {
    const puzzle = generatePuzzle(size, seed, 4), random = seededRandom(`long-play-${seed}`), removed = new Set();
    while (removed.size < puzzle.arrows.length) {
      const available = getRemovable(puzzle, removed);
      assert(available.length > 0);
      removed.add(available[Math.floor(random() * available.length)].id);
    }
  }
});

test('random long-path boards preserve geometry and solutions with a strict three-cell minimum', () => {
  for (const size of [2, 3, 4, 5, 6, 8, 12, 24, 32, 64]) {
    for (let seed = 0; seed < (size <= 4 ? 48 : size <= 12 ? 24 : 4); seed++) {
      const puzzle = generatePuzzle(size, seed, 5);
      assert.equal(puzzle.generatorVersion, 5);
      assert.equal(puzzle.gridSize, size * 2);
      assert(puzzle.arrows.every(arrow => arrow.cells.length >= 3 && arrow.cells.length <= 32));
      assert(validateGeometry(puzzle) > 0.85, 'small optional gaps must retain a dense surface');
      const longCount = puzzle.arrows.filter(arrow => arrow.cells.length >= 5).length;
      assert(longCount / puzzle.arrows.length >= 0.6, 'long paths should remain the majority');
    }
  }
});

test('random long-path boards mix directions and favor multiple bends over parallel rows', () => {
  for (const size of [5, 6, 8, 12, 32, 64]) for (let seed = 0; seed < (size < 16 ? 24 : 2); seed++) {
    const puzzle = generatePuzzle(size, seed, 5), faceDirections = Array.from({ length: 6 }, () => new Set());
    let bent = 0, multipleTurns = 0, wrapped = 0;
    const directions = new Set();
    for (const arrow of puzzle.arrows) {
      const heading = `${arrow.direction.x},${arrow.direction.y}`;
      directions.add(heading); faceDirections[arrow.face].add(heading);
      wrapped += new Set(arrow.cells.map(cell => cell.face)).size > 1;
      let turns = 0;
      for (let i = 1; i < arrow.cells.length - 1; i++) {
        const from = arrow.cells[i - 1], cell = arrow.cells[i], next = arrow.cells[i + 1];
        const incoming = neighbor(from, directionBetween(from, cell, puzzle.gridSize), puzzle.gridSize).direction;
        const outgoing = directionBetween(cell, next, puzzle.gridSize);
        turns += incoming.x !== outgoing.x || incoming.y !== outgoing.y;
      }
      bent += turns > 0; multipleTurns += turns > 1;
    }
    assert(bent / puzzle.arrows.length > 0.85);
    assert(multipleTurns / puzzle.arrows.length > 0.75, 'most paths need several genuine surface turns');
    assert.equal(directions.size, 4, 'all four head directions must occur');
    assert(faceDirections.reduce((sum, values) => sum + values.size, 0) / 6 > 2.5, 'directions must vary across the individual faces');
    assert(wrapped >= puzzle.gridSize * 2);
    assert(puzzle.arrows.filter(arrow => arrow.cells.length >= 5).length / puzzle.arrows.length > 0.7);
    assert(getRemovable(puzzle).length / puzzle.arrows.length < 0.25);
  }
});

test('arbitrary legal play never deadlocks random long-path boards', () => {
  for (const size of [2, 3, 6, 12]) for (let seed = 0; seed < 12; seed++) {
    const puzzle = generatePuzzle(size, seed, 5), random = seededRandom(`random-long-play-${seed}`), removed = new Set();
    while (removed.size < puzzle.arrows.length) {
      const available = getRemovable(puzzle, removed);
      assert(available.length > 0);
      removed.add(available[Math.floor(random() * available.length)].id);
    }
  }
});

test('roomier boards retain valid random paths on every supported level, including odd lane counts', () => {
  for (let size = 2; size <= 64; size++) for (let seed = 0; seed < (size <= 12 ? 12 : 1); seed++) {
    const puzzle = generatePuzzle(size, seed, 6);
    assert.equal(puzzle.generatorVersion, 6);
    assert.equal(puzzle.gridSize, Math.max(4, Math.round(size * 1.6)));
    assert(puzzle.arrows.every(arrow => arrow.cells.length >= 3 && arrow.cells.length <= 32));
    assert(validateGeometry(puzzle) > 0.85);
    assert(puzzle.arrows.filter(arrow => arrow.cells.length >= 5).length / puzzle.arrows.length >= 0.6);
  }
});

test('roomier boards reduce path counts while retaining bends, wrapping and mixed directions', () => {
  for (const size of [6, 8, 12]) {
    let previousCount = 0, currentCount = 0;
    for (let seed = 0; seed < 24; seed++) {
      const puzzle = generatePuzzle(size, seed, 6), directions = new Set(), faceDirections = Array.from({ length: 6 }, () => new Set());
      let multipleTurns = 0, wrapped = 0;
      previousCount += generatePuzzle(size, seed, 5).arrows.length;
      currentCount += puzzle.arrows.length;
      for (const arrow of puzzle.arrows) {
        const heading = `${arrow.direction.x},${arrow.direction.y}`;
        directions.add(heading); faceDirections[arrow.face].add(heading);
        wrapped += new Set(arrow.cells.map(cell => cell.face)).size > 1;
        let turns = 0;
        for (let i = 1; i < arrow.cells.length - 1; i++) {
          const from = arrow.cells[i - 1], cell = arrow.cells[i], next = arrow.cells[i + 1];
          const incoming = neighbor(from, directionBetween(from, cell, puzzle.gridSize), puzzle.gridSize).direction;
          const outgoing = directionBetween(cell, next, puzzle.gridSize);
          turns += incoming.x !== outgoing.x || incoming.y !== outgoing.y;
        }
        multipleTurns += turns > 1;
      }
      assert.equal(directions.size, 4);
      assert(faceDirections.reduce((sum, values) => sum + values.size, 0) / 6 > 2.5);
      assert(multipleTurns / puzzle.arrows.length > 0.75);
      assert(wrapped >= puzzle.gridSize * 2);
      assert(getRemovable(puzzle).length / puzzle.arrows.length < 0.25);
    }
    assert(currentCount / previousCount > 0.55 && currentCount / previousCount < 0.75, `level ${size}: reduce path counts by roughly a third`);
  }
});

test('extended paths retain valid geometry, bounded lengths and certified solutions', () => {
  for (const size of [2, 3, 4, 5, 6, 8, 12, 24, 32, 64]) {
    let longCount = 0, pathCount = 0;
    for (let seed = 0; seed < (size <= 4 ? 48 : size <= 12 ? 24 : 3); seed++) {
      const puzzle = generatePuzzle(size, seed, 7);
      assert.equal(puzzle.generatorVersion, 7);
      assert.equal(puzzle.gridSize, Math.max(4, Math.round(size * 1.6)));
      assert(puzzle.arrows.every(arrow => arrow.cells.length >= 3 && arrow.cells.length <= 96));
      assert(validateGeometry(puzzle) > 0.8);
      longCount += puzzle.arrows.filter(arrow => arrow.cells.length >= 5).length;
      pathCount += puzzle.arrows.length;
    }
    assert(longCount / pathCount > 0.75, 'generation should favor longer paths across seeds');
  }
});

test('extended boards visibly mix much longer winding paths with ordinary paths', () => {
  for (const size of [6, 8]) {
    let over32 = 0, over48 = 0, pathCount = 0, ordinary = 0, bent = 0;
    const headings = new Set();
    for (let seed = 0; seed < 24; seed++) {
      const puzzle = generatePuzzle(size, seed, 7);
      pathCount += puzzle.arrows.length;
      for (const arrow of puzzle.arrows) {
        over32 += arrow.cells.length > 32; over48 += arrow.cells.length > 48;
        ordinary += arrow.cells.length <= 20;
        headings.add(`${arrow.direction.x},${arrow.direction.y}`);
        bent += arrow.cells.some((cell, i, path) => {
          if (i < 2) return false;
          const before = neighbor(path[i - 2], directionBetween(path[i - 2], path[i - 1], puzzle.gridSize), puzzle.gridSize).direction;
          const after = directionBetween(path[i - 1], cell, puzzle.gridSize);
          return before.x !== after.x || before.y !== after.y;
        });
      }
    }
    assert(over32 / 24 >= 3, 'typical boards must contain several paths beyond the former cap');
    assert(over48 / 24 >= 1, 'much longer paths must occur in generated boards, not just be theoretically allowed');
    assert(ordinary / pathCount > 0.3, 'keep a mixture of ordinary and long paths');
    assert(bent / pathCount > 0.9);
    assert.equal(headings.size, 4);
  }
});

test('arbitrary legal play never deadlocks extended winding paths', () => {
  for (const size of [2, 3, 6, 8]) for (let seed = 0; seed < 12; seed++) {
    const puzzle = generatePuzzle(size, seed, 7), random = seededRandom(`extended-play-${seed}`), removed = new Set();
    while (removed.size < puzzle.arrows.length) {
      const available = getRemovable(puzzle, removed);
      assert(available.length > 0);
      removed.add(available[Math.floor(random() * available.length)].id);
    }
  }
});

test('version 8 caps every growth and join stage at 72 cells while retaining long paths', () => {
  let longCount = 0, ordinaryCount = 0, pathCount = 0;
  for (const size of [2, 3, 6, 8, 12, 64]) for (let seed = 0; seed < (size < 64 ? 16 : 3); seed++) {
    const puzzle = generatePuzzle(size, seed, 8);
    assert.equal(puzzle.generatorVersion, 8);
    assert.equal(puzzle.gridSize, Math.max(4, Math.round(size * 1.6)));
    assert(puzzle.arrows.every(arrow => arrow.cells.length >= 3 && arrow.cells.length <= 72));
    assert(validateGeometry(puzzle) > 0.8);
    if (size === 6 || size === 8) {
      pathCount += puzzle.arrows.length;
      longCount += puzzle.arrows.filter(arrow => arrow.cells.length > 48).length;
      ordinaryCount += puzzle.arrows.filter(arrow => arrow.cells.length <= 20).length;
    }
  }
  assert(longCount >= 32, 'typical boards should still include long winding paths');
  assert(ordinaryCount / pathCount > 0.3, 'ordinary target lengths remain part of the mix');
});

test('version 9 keeps paths within 50 cells while preserving valid solvable boards', () => {
  let longCount = 0, ordinaryCount = 0, pathCount = 0;
  for (const size of [2, 3, 6, 8, 12, 64]) for (let seed = 0; seed < (size < 64 ? 16 : 3); seed++) {
    const puzzle = generatePuzzle(size, seed, 9);
    assert(puzzle.arrows.every(arrow => arrow.cells.length >= 3 && arrow.cells.length <= 50), `size ${size}, seed ${seed}: path length outside 3–50 cells`);
    assert(validateGeometry(puzzle) > 0.8);
    if (size === 6 || size === 8) {
      pathCount += puzzle.arrows.length;
      longCount += puzzle.arrows.filter(arrow => arrow.cells.length > 32).length;
      ordinaryCount += puzzle.arrows.filter(arrow => arrow.cells.length <= 20).length;
    }
  }
  assert(longCount >= 32, 'typical boards should still include long winding paths');
  assert(ordinaryCount / pathCount > 0.3, 'ordinary paths remain part of the mix');
});

test('version 10 keeps paths within 75 cells while preserving valid solvable boards', () => {
  let longCount = 0, ordinaryCount = 0, pathCount = 0;
  for (const size of [2, 3, 6, 8, 12, 64]) for (let seed = 0; seed < (size < 64 ? 16 : 3); seed++) {
    const puzzle = generatePuzzle(size, seed, 10);
    assert(puzzle.arrows.every(arrow => arrow.cells.length >= 3 && arrow.cells.length <= 75), `size ${size}, seed ${seed}: path length outside 3–75 cells`);
    assert(validateGeometry(puzzle) > 0.8);
    if (size === 6 || size === 8) {
      pathCount += puzzle.arrows.length;
      longCount += puzzle.arrows.filter(arrow => arrow.cells.length > 50).length;
      ordinaryCount += puzzle.arrows.filter(arrow => arrow.cells.length <= 20).length;
    }
  }
  assert(longCount >= 32, 'typical boards should include paths longer than the former 50-cell cap');
  assert(ordinaryCount / pathCount > 0.3, 'ordinary paths remain part of the mix');
});

test('a wrapping arrow blocks lanes on the face occupied by its tail', () => {
  const puzzle = { size: 5, arrows: [
    { id: 0, face: 0, cells: [{ face: 0, x: 0, y: 2 }, { face: 0, x: 1, y: 2 }], direction: { x: 1, y: 0 } },
    { id: 1, face: 1, cells: [{ face: 0, x: 3, y: 2 }, { face: 0, x: 4, y: 2 }, { face: 1, x: 0, y: 2 }, { face: 1, x: 1, y: 2 }], direction: { x: 1, y: 0 } },
  ] };
  assert.equal(getBlockingArrow(puzzle, 0), 1);
  assert(!canRemove(puzzle, 0));
  assert(canRemove(puzzle, 0, new Set([1])));
});

test('blockers are identified and removed arrows clear the exit ray', () => {
  const puzzle = {
    size: 5,
    arrows: [
      { id: 0, face: 0, cells: [{ x: 0, y: 2 }, { x: 1, y: 2 }], direction: { x: 1, y: 0 } },
      { id: 1, face: 0, cells: [{ x: 3, y: 2 }, { x: 4, y: 2 }], direction: { x: 1, y: 0 } },
      { id: 2, face: 1, cells: [{ x: 0, y: 2 }, { x: 1, y: 2 }], direction: { x: 1, y: 0 } },
    ],
  };
  const before = JSON.stringify(puzzle);
  assert.equal(getBlockingArrow(puzzle, 0), 1);
  assert(!canRemove(puzzle, 0));
  assert(canRemove(puzzle, 1));
  assert(canRemove(puzzle, 2), 'other faces are independent');
  assert(canRemove(puzzle, 0, new Set([1])));
  assert(!canRemove(puzzle, 'missing'));
  assert.equal(JSON.stringify(puzzle), before, 'move queries do not mutate the board');
});

test('invalid dimensions are rejected instead of hanging or allocating huge grids', () => {
  for (const size of [0, 1, -1, 2.5, NaN, Infinity, 65, '4']) assert.throws(() => generatePuzzle(size, 1), RangeError);
  assert.throws(() => generatePuzzle(3, 1, 999), RangeError);
});
