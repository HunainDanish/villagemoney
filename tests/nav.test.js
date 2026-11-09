import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRoute, doorPoint } from '../src/nav.js';
import { housePosition, PITCH, LOT } from '../shared/layout.js';

const len = (r) => r.slice(1).reduce((a, p, i) => a + Math.hypot(p.x - r[i].x, p.z - r[i].z), 0);
const axisAligned = (r) => r.slice(1).every((p, i) => Math.abs(p.x - r[i].x) < 0.01 || Math.abs(p.z - r[i].z) < 0.01);

test('routes start and end where asked, and only move along streets (no diagonals)', () => {
  const from = { x: 0, z: 24 }; // plaza
  for (const id of [1, 70, 300, 1234, 2500]) {
    const to = doorPoint(id);
    const r = planRoute(from, to);
    assert.deepEqual(r[0], from);
    assert.deepEqual(r[r.length - 1], to);
    assert.ok(axisAligned(r.slice(0, -1)) || r.length === 2, `house ${id} route has a diagonal`);
    const straight = Math.hypot(to.x - from.x, to.z - from.z);
    assert.ok(len(r) < straight * 2.2 + 60, `house ${id} route is far too long`);
  }
});

test('nearby places get a direct route', () => {
  const r = planRoute({ x: 0, z: 0 }, { x: 10, z: 10 });
  assert.equal(r.length, 2);
});

test('route corners sit on road centre lines or lanes, never inside a house', () => {
  const r = planRoute({ x: 0, z: 24 }, doorPoint(700));
  for (const p of r.slice(1, -1)) {
    const onRoadX = Math.abs(((p.x / PITCH - 0.5) % 1 + 1) % 1) < 1e-6;
    const onRoadZ = Math.abs(((p.z / PITCH - 0.5) % 1 + 1) % 1) < 1e-6;
    const lz = ((p.z % PITCH) + PITCH * 1.5) % PITCH - PITCH / 2;
    const onLane = Math.abs(lz % 16) < 1e-6 && Math.abs(lz) < LOT / 2;
    const inPlaza = Math.abs(p.x) <= LOT / 2 && Math.abs(p.z) <= LOT / 2;
    const onPlazaWalkway = inPlaza && (Math.abs(Math.abs(p.x) - 17) < 1e-6 || Math.abs(Math.abs(p.z) - 17) < 1e-6);
    assert.ok(onRoadX || onRoadZ || onLane || onPlazaWalkway, `corner ${p.x},${p.z} is off the streets`);
  }
});

test('the door point is in front of the house', () => {
  const p = housePosition(42);
  const d = doorPoint(42);
  assert.ok(Math.abs(Math.hypot(d.x - p.x, d.z - p.z) - 7) < 1e-6);
});

test('leaving the plaza never walks through the fountain or the stalls', () => {
  for (const from of [{ x: 0, z: -22 }, { x: 0, z: 22 }, { x: -20, z: 5 }, { x: 25, z: -5 }]) {
    for (const id of [5, 300, 900]) {
      const r = planRoute(from, doorPoint(id));
      for (let i = 0; i < r.length - 1; i++) {
        const a = r[i];
        const b = r[i + 1];
        // sample the segment and check the fountain (r 10.4) and stall boxes
        for (let k = 0; k <= 20; k++) {
          const x = a.x + ((b.x - a.x) * k) / 20;
          const z = a.z + ((b.z - a.z) * k) / 20;
          assert.ok(Math.hypot(x, z) > 10.4, `through the fountain at ${x},${z}`);
          assert.ok(!(Math.abs(x) < 3 && Math.abs(z + 38) < 3), `through the grocer at ${x},${z}`);
          assert.ok(!(Math.abs(x) < 7 && Math.abs(z - 40) < 4.5), `through the showroom at ${x},${z}`);
        }
      }
    }
  }
});
