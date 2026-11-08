import { test } from 'node:test';
import assert from 'node:assert/strict';
import { houseModels, MODEL_COUNT } from '../src/houses.js';

// The collision box of every house must match its visible walls, or players
// hit invisible walls (box too big) or walk into houses (box too small).
test('house collision boxes match the drawn walls', () => {
  const models = houseModels();
  assert.equal(models.length, MODEL_COUNT);
  models.forEach((m, i) => {
    m.walls.computeBoundingBox();
    const b = m.walls.boundingBox;
    const { hx, hz, cx = 0, cz = 0 } = m.meta;
    const box = { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz };
    // Box may include the 0.15 foundation lip, but no invisible margin beyond it.
    for (const [name, wall, coll] of [
      ['left', b.min.x, box.minX],
      ['right', b.max.x, box.maxX],
      ['back', b.min.z, box.minZ],
      ['front', b.max.z, box.maxZ],
    ]) {
      assert.ok(Math.abs(wall - coll) <= 0.25, `model ${i} ${name}: walls at ${wall.toFixed(2)}, collision at ${coll.toFixed(2)}`);
    }
  });
});
