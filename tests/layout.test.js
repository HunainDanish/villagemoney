import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spiralCoord, spiralIndex, housePosition, blocksNear, normalizeUsername, blockOfHouse } from '../shared/layout.js';

test('spiral index and coordinate are inverses', () => {
  const seen = new Set();
  for (let n = 0; n < 100000; n++) {
    const [x, z] = spiralCoord(n);
    assert.equal(spiralIndex(x, z), n);
    const k = `${x},${z}`;
    assert.ok(!seen.has(k), `duplicate cell ${k}`);
    seen.add(k);
  }
});

test('every house gets a unique plot', () => {
  const seen = new Set();
  for (let id = 1; id <= 50000; id++) {
    const { x, z } = housePosition(id);
    const k = `${x},${z}`;
    assert.ok(!seen.has(k), `house ${id} collides`);
    seen.add(k);
  }
});

test('blocksNear only returns built blocks', () => {
  assert.deepEqual(blocksNear(0, 0, 1, 64), [0]);
  const b = blocksNear(0, 0, 2, 10000);
  assert.ok(b.every((x) => x >= 0 && x <= blockOfHouse(10000)));
  const { x, z } = housePosition(5000);
  assert.ok(blocksNear(x, z, 0, 10000).includes(blockOfHouse(5000)));
});

test('usernames are normalized to Instagram rules', () => {
  assert.equal(normalizeUsername(' @Some.User_1 '), 'some.user_1');
  assert.equal(normalizeUsername('bad name'), null);
  assert.equal(normalizeUsername('x'.repeat(31)), null);
  assert.equal(normalizeUsername(42), null);
});

import { gridToBlock, blockGrid, firstHouseOfBlock, lastHouseOfBlock, houseAt, districtOf, worldToGrid, cellKind } from '../shared/layout.js';

test('two districts of exactly 250 homes each, then the spiral', () => {
  const count = [0, 0];
  for (let id = 1; id <= 500; id++) {
    const { x, z } = housePosition(id);
    const [gx] = worldToGrid(x, z);
    const d = districtOf(id);
    count[d]++;
    assert.equal(gx, d === 0 ? -1 : 1, `house ${id} is in its district`);
  }
  assert.deepEqual(count, [250, 250]);
  assert.equal(districtOf(501), -1);
  const [gx] = worldToGrid(housePosition(501).x, housePosition(501).z);
  assert.ok(Math.abs(gx) >= 2 || cellKind(gx, 0) === 'block');
});

test('blocks and grid cells map both ways; the middle strip is kept free', () => {
  for (let b = 0; b < 3000; b++) {
    const [gx, gz] = blockGrid(b);
    assert.equal(gridToBlock(gx, gz), b, `block ${b}`);
    assert.equal(cellKind(gx, gz), 'block');
    assert.ok(houseAt(b, 0) === firstHouseOfBlock(b));
    for (let id = firstHouseOfBlock(b); id <= lastHouseOfBlock(b); id++) assert.equal(blockOfHouse(id), b);
  }
  assert.equal(gridToBlock(0, 0), -1);
  assert.equal(gridToBlock(0, 1), -2);
  assert.equal(gridToBlock(0, -1), -3);
  assert.equal(lastHouseOfBlock(3), 250);
  assert.equal(houseAt(3, 58), null);
  assert.equal(firstHouseOfBlock(4), 251);
  assert.equal(firstHouseOfBlock(8), 501);
});
