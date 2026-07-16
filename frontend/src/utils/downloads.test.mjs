// Offline registry. Run: node src/utils/downloads.test.mjs
//
// The bug this locks down: lookup was tolerant (title+artist fallback when the
// exact id misses, which happens whenever enrichment added an isrc after the
// download) while removal was exact-id only. So a song that showed as
// downloaded could not be un-downloaded — "Remove download" cleared nothing,
// the file stayed on disk, and the next disk scan re-added it. Every read and
// write has to resolve a track the same way.

import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
globalThis.window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.Event = class { constructor(type) { this.type = type; } };

const {
  saveOfflineEntry, getOfflineEntry, isDownloaded,
  removeOfflineEntry, offlineFilePath, readOfflineTracks, deleteDownload,
} = await import('./downloads.js');

// Downloaded, then enriched: same song, but now carrying an isrc it didn't have
// when it was saved — so getTrackId() no longer matches the stored key.
const saved = { title: 'The Less I Know The Better', artist: 'Tame Impala' };
const enriched = { ...saved, isrc: 'AUUM71500558' };

saveOfflineEntry(saved, { filePath: '/music/tame.m4a', bitrate: 320 });
assert.equal(Object.keys(readOfflineTracks()).length, 1);

// Found by the tolerant path...
assert.ok(isDownloaded(enriched), 'enriched track must still read as downloaded');
assert.equal(getOfflineEntry(enriched).bitrate, 320);
// ...so the file path must resolve too, or the backend is never asked to delete
// the file and the next scan resurrects the entry.
assert.equal(offlineFilePath(enriched), '/music/tame.m4a');

// ...and removal must find it by the SAME rule.
removeOfflineEntry(enriched);
assert.deepEqual(readOfflineTracks(), {}, 'remove must clear the tolerantly-matched entry');
assert.equal(isDownloaded(saved), false);

// A different song must never be matched into someone else's entry.
saveOfflineEntry(saved, { filePath: '/music/tame.m4a' });
removeOfflineEntry({ title: 'Elephant', artist: 'Tame Impala' });
assert.equal(Object.keys(readOfflineTracks()).length, 1, 'removed the wrong track');

// deleteDownload always clears the registry — even when the backend can't find
// the file — so a failed delete can't leave a ghost "downloaded" row behind.
let asked = '';
const api = { deleteDownloadFile: async (p) => { asked = p; return { ok: false }; } };
assert.equal(await deleteDownload(saved, api), false);
assert.equal(asked, '/music/tame.m4a');
assert.deepEqual(readOfflineTracks(), {});

console.log('OK: downloads');
