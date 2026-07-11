import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { getPlayableSource } from '../utils/tracks';
import { saveOfflineEntry, isDownloaded, mergeScannedTracks } from '../utils/downloads';
import { readAppSettings, qualityToBitrate } from '../utils/settings';
import { toast } from '../utils/toast';

const DownloadsContext = createContext();
const ACTIVE = new Set(['pending', 'queued', 'downloading']);

export function DownloadsProvider({ children }) {
  const [tasks, setTasks] = useState([]);
  const [downloadDir, setDownloadDir] = useState('');
  const pollRef = useRef(null);
  // Task ids already announced. We DON'T toast for downloads that were already
  // complete when the app loaded — only for ones that finish during this
  // session. The first refresh seeds this set silently (see refresh(silent)).
  const savedRef = useRef(new Set());

  const refresh = useCallback(async (silent = false) => {
    const list = await api.listDownloads();
    setTasks(list);
    // Persist newly-completed downloads to the offline registry.
    for (const t of list) {
      if (t.status === 'completed' && t.file_path && !savedRef.current.has(t.id)) {
        savedRef.current.add(t.id);
        const track = t.track_info || {};
        saveOfflineEntry(track, {
          filePath: t.file_path, bitrate: t.bitrate, codec: t.codec, size: t.file_size,
        });
        // Only announce completions that happen during this session, not the
        // ones that were already done when the page loaded/refreshed.
        if (!silent) toast(`Downloaded: ${track.title || 'track'}`);
      }
    }
    return list;
  }, []);

  const ensurePolling = useCallback(() => {
    if (pollRef.current) return;
    // 500ms, not 1500: a song is only a few MB and finishes in a couple of
    // seconds on a phone, so a slow poll caught just the 0% and 100% frames and
    // the bar appeared to jump. At 500ms the backend's real per-chunk progress
    // (hundreds of updates) shows as a smooth fill.
    pollRef.current = setInterval(async () => {
      const list = await refresh();
      if (!list.some(t => ACTIVE.has(t.status))) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 500);
  }, [refresh]);

  // Initial load: fetch dir + tasks, resume polling if something is active.
  // Silent so already-finished downloads don't fire "Downloaded:" toasts on
  // every page refresh — only live completions (via polling) announce.
  useEffect(() => {
    api.getDownloadsInfo().then(info => setDownloadDir(info.download_dir || ''));
    // Rebuild the offline library from disk (source of truth) so downloads play
    // offline even after a cleared registry / reinstall / backend restart.
    api.scanLocalDownloads().then(items => mergeScannedTracks(items)).catch(() => {});
    refresh(true).then(list => { if (list.some(t => ACTIVE.has(t.status))) ensurePolling(); });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh, ensurePolling]);

  const startDownload = useCallback(async (track) => {
    if (isDownloaded(track)) { toast('Already downloaded'); return; }
    const source = getPlayableSource(track);
    const url = track?.sources?.[source]?.url;
    if (!url) { toast("This track can't be downloaded"); return; }
    try {
      const maxBitrate = qualityToBitrate(readAppSettings().audioQuality);
      await api.downloadTrack(url, track, { maxBitrate });
      toast(`Downloading: ${track.title || 'track'}`);
      await refresh();
      ensurePolling();
    } catch {
      toast('Could not start download');
    }
  }, [refresh, ensurePolling]);

  // Bulk download a whole collection: enqueue every playable, not-yet-downloaded
  // track via the same per-track endpoint, then ONE summary toast + one refresh.
  const downloadMany = useCallback(async (tracks) => {
    const maxBitrate = qualityToBitrate(readAppSettings().audioQuality);
    let started = 0;
    for (const track of tracks || []) {
      if (isDownloaded(track)) continue;
      const source = getPlayableSource(track);
      const url = track?.sources?.[source]?.url;
      if (!url) continue;
      try { await api.downloadTrack(url, track, { maxBitrate }); started++; } catch { /* skip this one */ }
    }
    if (started > 0) {
      toast(`Downloading ${started} song${started > 1 ? 's' : ''}`);
      await refresh();
      ensurePolling();
    } else {
      toast('Nothing new to download');
    }
  }, [refresh, ensurePolling]);

  const cancel = useCallback(async (id) => { await api.cancelDownload(id); await refresh(); }, [refresh]);
  const retry = useCallback(async (id) => { await api.retryDownload(id); await refresh(); ensurePolling(); }, [refresh, ensurePolling]);
  const clearCompleted = useCallback(async () => {
    await api.clearCompletedDownloads();
    await refresh();
  }, [refresh]);

  return (
    <DownloadsContext.Provider value={{ tasks, downloadDir, startDownload, downloadMany, cancel, retry, clearCompleted, refresh }}>
      {children}
    </DownloadsContext.Provider>
  );
}

export function useDownloads() {
  return useContext(DownloadsContext);
}
