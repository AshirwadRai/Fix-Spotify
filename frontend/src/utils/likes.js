// Liked-songs store, backed by localStorage with live propagation.
//
// Mirrors the offline-downloads registry pattern (utils/downloads.js): a single
// source of truth that every component subscribes to via useLikedSongs(), so a
// like toggled anywhere (row heart, context menu, now-playing panel) instantly
// updates everywhere — no per-view duplicated state, no desync.

import { useState, useEffect } from 'react';
import { cleanText, normalizeTrack, readStoredTracks, writeStoredTracks } from './tracks';

const KEY = 'likedSongs';
const EVENT = 'likedchange';

const sameTrack = (a, b) =>
  cleanText(a?.title) === cleanText(b?.title) && cleanText(a?.artist) === cleanText(b?.artist);

/** Current liked songs (normalized, playable). */
export function readLiked() {
  return readStoredTracks(KEY);
}

export function isLiked(track) {
  if (!track) return false;
  return readStoredTracks(KEY).some(t => sameTrack(t, track));
}

/** Set a track's liked state explicitly. Dispatches a live-update event. */
export function setLikedState(track, liked) {
  if (!track) return;
  const cur = readStoredTracks(KEY);
  const exists = cur.some(t => sameTrack(t, track));
  let updated;
  if (liked && !exists) updated = [...cur, normalizeTrack(track)];
  else if (!liked && exists) updated = cur.filter(t => !sameTrack(t, track));
  else return; // no change
  writeStoredTracks(KEY, updated);
  window.dispatchEvent(new Event(EVENT));
}

/** Toggle a track's liked state. Returns the new state. */
export function toggleLiked(track) {
  const next = !isLiked(track);
  setLikedState(track, next);
  return next;
}

/** React hook: live array of liked songs, re-rendering on any change. */
export function useLikedSongs() {
  const [list, setList] = useState(readLiked);
  useEffect(() => {
    const handler = () => setList(readLiked());
    window.addEventListener(EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  return list;
}
