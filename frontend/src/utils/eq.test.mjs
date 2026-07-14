// Equalizer curve resolution. Run: node src/utils/eq.test.mjs
//
// resolveGains() decides what the filters actually get set to, and PlayerContext
// only builds the Web Audio graph when the result isn't flat. Get it wrong in
// either direction and you either route audio through a graph for nothing, or
// silently ignore the EQ the user just dialled in.

import assert from 'node:assert/strict';
import {
  EQ_BANDS, EQ_MIN_DB, EQ_MAX_DB, FLAT,
  resolveGains, presetGains, normalizeGains, isFlat, bandLabel,
} from './eq.js';

// Every preset must cover every band, in range. A short curve would leave the
// tail bands at whatever the last preset set them to.
for (const id of ['rock', 'metal', 'classical', 'electronic', 'bass', 'treble']) {
  const g = presetGains(id);
  assert.equal(g.length, EQ_BANDS.length, `${id} must define all ${EQ_BANDS.length} bands`);
  for (const db of g) {
    assert.ok(db >= EQ_MIN_DB && db <= EQ_MAX_DB, `${id}: ${db}dB is out of range`);
  }
  assert.ok(!isFlat(g), `${id} must actually do something`);
}

// Disabled => flat, whatever else is stored. This is what keeps the audio out of
// Web Audio entirely when the user hasn't asked for EQ.
assert.deepEqual(
  resolveGains({ eqEnabled: false, eqPreset: 'metal', eqGains: [9, 9, 9, 9, 9, 9, 9, 9] }),
  FLAT
);
assert.ok(isFlat(resolveGains({ eqEnabled: false, eqPreset: 'rock' })));

// A named preset wins over stored custom gains.
assert.deepEqual(
  resolveGains({ eqEnabled: true, eqPreset: 'rock', eqGains: [1, 1, 1, 1, 1, 1, 1, 1] }),
  presetGains('rock')
);

// 'custom' has no curve of its own, so it falls through to the user's gains.
assert.deepEqual(
  resolveGains({ eqEnabled: true, eqPreset: 'custom', eqGains: [3, 0, 0, 0, 0, 0, 0, -3] }),
  [3, 0, 0, 0, 0, 0, 0, -3]
);

// 'flat' is a real preset and must stay flat even when enabled.
assert.ok(isFlat(resolveGains({ eqEnabled: true, eqPreset: 'flat' })));

// Junk from localStorage must never reach a filter node: NaN sets gain to NaN and
// silences the whole chain. Out-of-range values clamp instead of clipping.
assert.deepEqual(normalizeGains(null), FLAT);
assert.deepEqual(normalizeGains([99, -99, 'x', undefined, NaN, 5, null, 2]), [12, -12, 0, 0, 0, 5, 0, 2]);
assert.deepEqual(normalizeGains([1, 2]), [1, 2, 0, 0, 0, 0, 0, 0]);   // short array is padded

assert.equal(bandLabel(60), '60');
assert.equal(bandLabel(16000), '16k');

console.log('OK: eq curves resolve, clamp, and stay flat when off');
