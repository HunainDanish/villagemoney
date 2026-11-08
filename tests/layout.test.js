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
