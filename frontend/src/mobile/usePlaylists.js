// Playlist CRUD on top of the shared localStorage store (utils/tracks.js).
//
// The desktop app creates playlists inside LibraryView; the mobile build needs
// the same operations from several places (Library, the track action sheet, the
// now-playing screen), so they live here rather than in one component.
//
// A playlist is: { id, name, tracks: [], createdAt }

import { useState, useEffect } from 'react';
import { readPlaylists, writePlaylists, getTrackId, normalizeTrack } from '../utils/tracks';

const EVENT = 'playlistschange';

function emit() {
  window.dispatchEvent(new Event(EVENT));
}

export function createPlaylist(name) {
  const clean = (name || '').trim();
  if (!clean) return null;
  const playlist = {
    id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: clean,
    tracks: [],
    createdAt: Date.now(),
  };
  writePlaylists([playlist, ...readPlaylists()]);
  emit();
  return playlist;
}

export function deletePlaylist(id) {
  writePlaylists(readPlaylists().filter((p) => p.id !== id));
  emit();
}

export function renamePlaylist(id, name) {
  const clean = (name || '').trim();
  if (!clean) return;
  writePlaylists(readPlaylists().map((p) => (p.id === id ? { ...p, name: clean } : p)));
  emit();
}

/** Returns true if the track was added, false if it was already there. */
export function addTrackToPlaylist(id, track) {
  const t = normalizeTrack(track);
  const tid = getTrackId(t);
  let added = false;
  writePlaylists(
    readPlaylists().map((p) => {
      if (p.id !== id) return p;
      if ((p.tracks || []).some((x) => getTrackId(x) === tid)) return p;  // no duplicates
      added = true;
      return { ...p, tracks: [...(p.tracks || []), t] };
    })
  );
  if (added) emit();
  return added;
}

export function removeTrackFromPlaylist(id, track) {
  const tid = getTrackId(normalizeTrack(track));
  writePlaylists(
    readPlaylists().map((p) =>
      p.id === id
        ? { ...p, tracks: (p.tracks || []).filter((x) => getTrackId(x) !== tid) }
        : p
    )
  );
  emit();
}

/** Live list of playlists, re-rendering whenever any of the above mutates them. */
export function usePlaylists() {
  const [list, setList] = useState(readPlaylists);
  useEffect(() => {
    const handler = () => setList(readPlaylists());
    window.addEventListener(EVENT, handler);
    window.addEventListener('storage', handler);   // survives a WebView reload
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  return list;
}
