// Offline-downloads registry, backed by localStorage with live propagation.
//
// Maps a track id (getTrackId) -> {
//   track, filePath, bitrate, codec, size, downloadedAt
// }. This is the source of truth for "is this track downloaded" badges and the
// offline library. The actual audio files live on disk (managed by the backend
// download manager); this just records where they are.

import { useState, useEffect } from 'react';
import { getTrackId, cleanText } from './tracks';

const KEY = 'offlineTracks';
const EVENT = 'offlinechange';

export function readOfflineTracks() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function writeOfflineTracks(map) {
  localStorage.setItem(KEY, JSON.stringify(map));
  window.dispatchEvent(new Event(EVENT));
}

/** The offline entry for a track, or null if not downloaded. */
export function getOfflineEntry(track) {
  if (!track) return null;
  const map = readOfflineTracks();
  const exact = map[getTrackId(track)];
  if (exact) return exact;
  // Tolerant fallback: the entry is keyed on the FINALIZED track_info (which may
  // have gained an isrc from enrichment that the catalog track lacks), so an
  // exact id miss isn't conclusive. Match on title+artist instead.
  // ponytail: title+artist only — if enrichment also renamed the artist
  // (non-JioSaavn iTunes cleanup) this can still miss; upgrade = store the entry
  // under the original requested track's id too.
  const t = cleanText(track.title).toLowerCase();
  const a = cleanText(track.artist).toLowerCase();
  if (!t) return null;
  for (const entry of Object.values(map)) {
    if (cleanText(entry.track?.title).toLowerCase() === t &&
        cleanText(entry.track?.artist).toLowerCase() === a) {
      return entry;
    }
  }
  return null;
}

export function isDownloaded(track) {
  return getOfflineEntry(track) != null;
}

/** Record a completed download. `track` is the original track object. */
export function saveOfflineEntry(track, { filePath, bitrate, codec, size }) {
  if (!track || !filePath) return;
  const map = readOfflineTracks();
  map[getTrackId(track)] = {
    track,
    filePath,
    bitrate: bitrate || 0,
    codec: codec || '',
    size: size || 0,
    downloadedAt: Date.now(),
  };
  writeOfflineTracks(map);
}

/** Remove a track from the offline registry (does not delete the file). */
export function removeOfflineEntry(track) {
  const map = readOfflineTracks();
  const id = getTrackId(track);
  if (map[id]) {
    delete map[id];
    writeOfflineTracks(map);
  }
}

/** The on-disk path for a downloaded track, or '' if we don't have it. */
export function offlineFilePath(track) {
  const map = readOfflineTracks();
  const entry = map[getTrackId(track)];
  return (entry && entry.filePath) || '';
}

/**
 * Fully delete a download: remove the FILE from disk (backend) AND drop the
 * registry entry. Returns true if the file was deleted. Registry is cleared
 * regardless, so a missing/failed file can't leave a ghost "downloaded" state.
 */
export async function deleteDownload(track, api) {
  const path = offlineFilePath(track);
  let ok = false;
  if (path) {
    try {
      const res = await api.deleteDownloadFile(path);
      ok = !!res.ok;
    } catch { /* fall through — still clear the registry */ }
  }
  removeOfflineEntry(track);
  return ok;
}

/**
 * Merge a disk scan (backend /api/downloads/local) into the registry so the
 * offline library reflects what's actually on disk — survives a cleared
 * localStorage / reinstall / backend restart. Only ADDS files we don't already
 * have (existing session entries carry richer metadata/artwork, so we keep
 * them). Does NOT prune missing files — the play-time 404 self-heal handles a
 * deleted file. `items` are {title,artist,album,duration_ms,bitrate,codec,
 * file_size,file_path} from the scan.
 */
export function mergeScannedTracks(items) {
  if (!Array.isArray(items) || items.length === 0) return;
  const map = readOfflineTracks();
  let changed = false;
  for (const it of items) {
    if (!it || !it.file_path || !it.title) continue;
    const track = {
      title: it.title,
      artist: it.artist || '',
      album: it.album || '',
      duration_ms: it.duration_ms || 0,
      sources: {},
    };
    const id = getTrackId(track);
    if (map[id]) continue; // keep the richer existing entry
    map[id] = {
      track,
      filePath: it.file_path,
      bitrate: it.bitrate || 0,
      codec: it.codec || '',
      size: it.file_size || 0,
      downloadedAt: 0,
      scanned: true,
    };
    changed = true;
  }
  if (changed) writeOfflineTracks(map);
}

/** React hook: live map of offline tracks, re-rendering on any change. */
export function useOfflineTracks() {
  const [map, setMap] = useState(readOfflineTracks);
  useEffect(() => {
    const handler = () => setMap(readOfflineTracks());
    window.addEventListener(EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  return map;
}
