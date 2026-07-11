// Saved-collections store (albums + JioSaavn playlists the user adds to their
// library), backed by localStorage with live propagation. Mirrors likes.js /
// downloads.js: one source of truth, every view subscribes via
// useSavedCollections(), so a save toggled anywhere updates the sidebar and
// library instantly.
//
// Each entry carries enough to (a) show a card, (b) reopen the view, and (c)
// power library search by song name.
// ponytail: we snapshot the full tracklist per saved collection so library song
// search + play work offline-of-network. Ceiling = localStorage size if a user
// saves hundreds of large albums; upgrade path = store reopen params only and
// refetch tracks on demand.

import { useState, useEffect } from 'react';
import { normalizeTracks } from './tracks';

const KEY = 'savedCollections';
const EVENT = 'savedcollectionschange';

export function readSavedCollections() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function write(list) {
  localStorage.setItem(KEY, JSON.stringify(Array.isArray(list) ? list : []));
  window.dispatchEvent(new Event(EVENT));
}

/** Stable identity for a saved collection (albumId/url/songUrl, else name+artist). */
export function collectionId(c) {
  if (!c) return '';
  return String(c.albumId || c.url || c.songUrl || `${c.name || ''}|${c.artist || ''}`).toLowerCase();
}

export function isSaved(collection) {
  const id = collectionId(collection);
  return readSavedCollections().some(c => collectionId(c) === id);
}

/** Toggle a collection's saved state. Returns the new state (true = saved). */
export function toggleSaved(collection) {
  if (!collection) return false;
  const id = collectionId(collection);
  const cur = readSavedCollections();
  const exists = cur.some(c => collectionId(c) === id);
  if (exists) {
    write(cur.filter(c => collectionId(c) !== id));
    return false;
  }
  const entry = {
    type: collection.type || 'album',     // 'album' | 'jsplaylist'
    name: collection.name || '',
    artist: collection.artist || '',
    subtitle: collection.subtitle || '',
    image: collection.image || '',
    songUrl: collection.songUrl || '',
    albumId: collection.albumId || '',
    url: collection.url || '',
    tracks: normalizeTracks(collection.tracks || []),
    savedAt: Date.now(),
  };
  write([...cur, entry]);
  return true;
}

export function removeSaved(collection) {
  const id = collectionId(collection);
  write(readSavedCollections().filter(c => collectionId(c) !== id));
}

/**
 * If this collection is already saved, refresh its stored tracklist snapshot to
 * the freshly-fetched live tracks (keeps library song-search in sync with the
 * source playlist without a manual re-save). No-op when not saved or no change.
 */
export function refreshSavedTracks(collection, tracks) {
  const id = collectionId(collection);
  const cur = readSavedCollections();
  const idx = cur.findIndex(c => collectionId(c) === id);
  if (idx < 0) return;
  const fresh = normalizeTracks(tracks || []);
  if (fresh.length === 0) return;
  const prev = cur[idx].tracks || [];
  const sameLen = prev.length === fresh.length;
  const sameTitles = sameLen && fresh.every((t, i) => (t.title || '') === (prev[i]?.title || ''));
  if (sameTitles) return; // nothing changed — skip the write + event churn
  const updated = [...cur];
  updated[idx] = { ...cur[idx], tracks: fresh };
  write(updated);
}

/** React hook: live array of saved collections. */
export function useSavedCollections() {
  const [list, setList] = useState(readSavedCollections);
  useEffect(() => {
    const handler = () => setList(readSavedCollections());
    window.addEventListener(EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  return list;
}
