// Queue ordering. Run: node src/utils/queue.test.mjs
//
// The reported bug: "when i add to queue it occupies top place, instead should
// occupy 2nd then 3rd place in music stack" — every add jumped the queue, so
// three adds played back to front.

import assert from 'node:assert/strict';
import { insertQueued } from './queue.js';

const t = (title) => ({ title, artist: 'X', sources: { jiosaavn: { url: 'u' } } });
const titles = (q) => q.map((x) => x.title);

// The album that's already playing, sitting in the queue behind the current song.
const album = [t('album-1'), t('album-2'), t('album-3')];

// Add to queue: successive adds land 1st, 2nd, 3rd — IN ORDER — ahead of the album.
{
  let q = album;
  q = insertQueued(q, t('a'));
  q = insertQueued(q, t('b'));
  q = insertQueued(q, t('c'));
  assert.deepEqual(titles(q), ['a', 'b', 'c', 'album-1', 'album-2', 'album-3']);
}

// Play next jumps the whole hand-queued block — that's what makes it different.
{
  let q = album;
  q = insertQueued(q, t('a'));
  q = insertQueued(q, t('b'));
  q = insertQueued(q, t('jump'), { playNext: true });
  assert.deepEqual(titles(q), ['jump', 'a', 'b', 'album-1', 'album-2', 'album-3']);
}

// Queueing something already queued MOVES it to the end of the block, never
// duplicates it.
{
  let q = insertQueued(insertQueued(album, t('a')), t('b'));
  q = insertQueued(q, t('a'));
  assert.deepEqual(titles(q), ['b', 'a', 'album-1', 'album-2', 'album-3']);
}

// An empty queue is not a special case.
assert.deepEqual(titles(insertQueued([], t('only'))), ['only']);

// Never mutates the input.
{
  const before = [...album];
  insertQueued(album, t('a'));
  assert.deepEqual(titles(album), titles(before));
}

console.log('OK: queued songs play in the order they were added');
