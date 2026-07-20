import { getTrackId } from './tracks.js';

/**
 * Where a hand-queued song goes.
 *
 * Songs the user queued by hand form a BLOCK at the head of the queue, ahead of
 * the rest of the album (and of any autoplay-radio picks), but in the order they
 * were added: the first "add to queue" plays next, the second after it, and so
 * on. `_queued` is what marks that block, so a later add can find its END rather
 * than barging in at the top.
 *
 * `playNext: true` is the deliberate queue-jump — straight to the front, ahead
 * even of the block. That is the entire difference between "Play next" and "Add
 * to queue"; both used to front-insert, so queueing three songs played them back
 * to front.
 *
 * Pure and total: returns a new array, never mutates `queue`.
 */
export function insertQueued(queue, track, { playNext = false } = {}) {
  const id = getTrackId(track);
  // Re-queueing a song already in the queue MOVES it rather than duplicating it.
  const rest = queue.filter((t) => getTrackId(t) !== id);
  const marked = { ...track, _queued: true };

  if (playNext) return [marked, ...rest];

  let end = 0;
  while (end < rest.length && rest[end]._queued) end += 1;
  return [...rest.slice(0, end), marked, ...rest.slice(end)];
}
