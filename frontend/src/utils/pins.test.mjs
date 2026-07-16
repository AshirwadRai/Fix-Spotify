// Pinned library rows. Run: node src/utils/pins.test.mjs
//
// "I pinned it and it didn't move" is the whole reason this file exists. The
// store is what decides both the order and the little pin marker, and every
// symptom of it being wrong looks identical to a UI bug, so pin it down here.

import assert from 'node:assert/strict';

// Minimal browser shim — pins.js only needs localStorage and window events.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
let dispatched = 0;
globalThis.window = {
  dispatchEvent: () => { dispatched += 1; return true; },
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.Event = class { constructor(type) { this.type = type; } };

const { readPins, togglePin, isPinned, rowId, sortPinned, MAX_PINS } =
  await import('./pins.js');

const reset = () => { store.clear(); dispatched = 0; };

// ── Toggling ────────────────────────────────────────────────────────────────
reset();
assert.deepEqual(readPins(), []);
assert.equal(togglePin('pl:a'), 'pinned');
assert.ok(isPinned('pl:a'));
// A pin that doesn't notify is a pin the library never re-renders for — this is
// exactly the "have to leave the tab and come back" failure.
assert.equal(dispatched, 1, 'pinning must fire the change event');

assert.equal(togglePin('pl:a'), 'unpinned');
assert.equal(isPinned('pl:a'), false);
assert.equal(dispatched, 2, 'unpinning must fire the change event too');

// ── The cap ─────────────────────────────────────────────────────────────────
reset();
for (let i = 0; i < MAX_PINS; i += 1) assert.equal(togglePin(`pl:${i}`), 'pinned');
// The 6th must REFUSE and say so, not silently do nothing — the caller shows a
// toast on 'full', and without it the user just sees a dead menu item.
assert.equal(togglePin('pl:extra'), 'full');
assert.equal(readPins().length, MAX_PINS);
assert.equal(isPinned('pl:extra'), false);
// Unpinning one makes room again.
togglePin('pl:0');
assert.equal(togglePin('pl:extra'), 'pinned');

// ── Ordering ────────────────────────────────────────────────────────────────
reset();
const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
const idOf = (p) => rowId('playlist', p);
assert.equal(idOf({ id: 'a' }), 'pl:a');

// Nothing pinned → original order, untouched.
assert.deepEqual(sortPinned(rows, [], idOf).map((r) => r.id), ['a', 'b', 'c', 'd']);

// Pinned rows go to the top; unpinned keep their relative order below.
assert.deepEqual(sortPinned(rows, ['pl:c'], idOf).map((r) => r.id), ['c', 'a', 'b', 'd']);

// The SECOND pin lands below the first: pin order is insertion order, not the
// library's. ("after 1st pin it should appear as 2nd pinned option")
assert.deepEqual(
  sortPinned(rows, ['pl:c', 'pl:a'], idOf).map((r) => r.id),
  ['c', 'a', 'b', 'd']
);
assert.deepEqual(
  sortPinned(rows, ['pl:d', 'pl:b'], idOf).map((r) => r.id),
  ['d', 'b', 'a', 'c']
);

// sortPinned must not mutate its input — the caller passes the live store array.
const before = [...rows];
sortPinned(rows, ['pl:d'], idOf);
assert.deepEqual(rows, before);

// Albums key off name+artist, case-insensitively, since they carry no id.
assert.equal(
  rowId('album', { name: 'Currents', artist: 'Tame Impala' }),
  rowId('album', { name: 'CURRENTS', artist: 'tame impala' })
);

console.log('OK: pins');
