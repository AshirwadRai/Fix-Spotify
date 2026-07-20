// Pinned library rows — the handful you keep at the top.
//
// Stores IDS ONLY, never copies of the playlist/album. A pin has to survive the
// thing it points at being renamed, re-covered or having tracks added, and a
// snapshot would go stale the moment any of that happened. The library row is
// still the source of truth; a pin just reorders it.

import { useState, useEffect } from 'react';

const KEY = 'pinnedLibrary';
const EVENT = 'pinnedchange';

/** Spotify caps its own pins around here; more than this and "pinned" is just
 *  "the list again", which defeats the point. */
export const MAX_PINS = 5;

export function readPins() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writePins(ids) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.slice(0, MAX_PINS)));
  } catch { /* storage full — a pin is not worth throwing over */ }
  window.dispatchEvent(new Event(EVENT));
}

export function isPinned(id) {
  return !!id && readPins().includes(id);
}

/**
 * Toggle a pin. Returns:
 *   'pinned' | 'unpinned' | 'full'  — 'full' when already at MAX_PINS, so the
 * caller can tell the user WHY nothing happened rather than silently no-op.
 */
export function togglePin(id) {
  if (!id) return 'full';
  const pins = readPins();
  if (pins.includes(id)) {
    writePins(pins.filter((x) => x !== id));
    return 'unpinned';
  }
  if (pins.length >= MAX_PINS) return 'full';
  writePins([...pins, id]);
  return 'pinned';
}

/** React hook: the pinned id list, live. */
export function usePins() {
  const [pins, setPins] = useState(readPins);
  useEffect(() => {
    const sync = () => setPins(readPins());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);   // cross-tab
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return pins;
}

/**
 * Stable id for a library row. Playlists already carry one; saved albums and
 * artists don't, so they're keyed by type+name+artist — the same triple the
 * library itself de-dupes on.
 */
export function rowId(kind, item) {
  if (kind === 'playlist') return `pl:${item.id}`;
  return `${kind}:${(item.name || '').toLowerCase()}:${(item.artist || '').toLowerCase()}`;
}

/** Sort pinned rows to the top, keeping each group's own order otherwise. */
export function sortPinned(rows, pins, idOf) {
  return [...rows].sort((a, b) => {
    const pa = pins.indexOf(idOf(a));
    const pb = pins.indexOf(idOf(b));
    if (pa === -1 && pb === -1) return 0;
    if (pa === -1) return 1;
    if (pb === -1) return -1;
    return pa - pb;   // earlier pins stay above later ones
  });
}
