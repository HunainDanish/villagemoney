import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunPhase, sunTimes } from '../src/sky.js';

test('local clock maps onto the sun day', () => {
  assert.equal(sunPhase(6, 6, 18), 0.25); // sunrise
  assert.equal(sunPhase(12, 6, 18), 0.5); // noon
  assert.equal(sunPhase(18, 6, 18), 0.75); // sunset
  assert.equal(sunPhase(0, 6, 18), 0); // midnight
  for (let h = 0; h < 24; h += 0.5) {
    const p = sunPhase(h, 7, 17);
    assert.ok(p >= 0 && p < 1);
  }
});

test('days are longer in summer than in winter', () => {
  const june = sunTimes(new Date(2026, 5, 21));
  const dec = sunTimes(new Date(2026, 11, 21));
  assert.ok(june.set - june.rise > dec.set - dec.rise);
});
