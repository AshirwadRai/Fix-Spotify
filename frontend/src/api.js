// src/api.js - API client for the Python backend
//
// All endpoints use fetch() → Python HTTP (both dev via Vite proxy and the
// packaged EXE via the resolved API base). A few Tauri-only commands
// (settings, openPath, backendStatus) still use invoke() for Rust state /
// OS access.

import { apiUrl, isTauri } from './utils/config';
import { toast } from './utils/toast';

/**
 * Lazy-load Tauri's invoke function to avoid import errors in browser.
 */
let _invoke = null;
async function getInvoke() {
  if (_invoke) return _invoke;
  try {
    const tauri = await import('@tauri-apps/api/core');
    _invoke = tauri.invoke;
    return _invoke;
  } catch {
    return null;
  }
}

class ApiClient {
  /**
   * Search for tracks across all sources.
   */
  async search(query, options = {}) {
    const response = await fetch(apiUrl('/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        limit: options.limit || 20,
      }),
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get autocomplete suggestions for the search query.
   */
  async getSuggestions(query, limit = 8) {
    if (query.length < 2) return { suggestions: [] };

    const response = await fetch(
      apiUrl(`/search/suggestions?q=${encodeURIComponent(query)}&limit=${limit}`)
    );

    if (!response.ok) {
      throw new Error(`Suggestions failed: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get a direct playable streaming URL for a track without downloading it.
   */
  async getStreamUrl(url, source) {
    const response = await fetch(apiUrl('/stream_url'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, source }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get stream URL: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Start downloading a track. HTTP-based (works in dev and the EXE via the
   * runtime API base). Returns { task_id, status, message }.
   */
  async downloadTrack(url, trackInfo, options = {}) {
    const response = await fetch(apiUrl('/download'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        track_info: trackInfo,
        output_dir: options.outputDir || '',
        max_bitrate: options.maxBitrate || 320,
      }),
    });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }
    return response.json();
  }

  /** Status of a single download task. Never throws. */
  async getDownloadStatus(taskId) {
    try {
      const r = await fetch(apiUrl(`/download/${taskId}`));
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  /** Full list of download tasks (newest first). Never throws. */
  async listDownloads() {
    try {
      const r = await fetch(apiUrl('/downloads'));
      if (!r.ok) return [];
      const data = await r.json();
      return data.tasks || [];
    } catch {
      return [];
    }
  }

  /** Current download directory. Never throws. */
  async getDownloadsInfo() {
    try {
      const r = await fetch(apiUrl('/downloads/info'));
      if (!r.ok) return { download_dir: '' };
      return await r.json();
    } catch {
      return { download_dir: '' };
    }
  }

  /** Scan the download folder → offline library from embedded tags. Never throws. */
  async scanLocalDownloads() {
    try {
      const r = await fetch(apiUrl('/downloads/local'));
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data.tracks) ? data.tracks : [];
    } catch {
      return [];
    }
  }

  async cancelDownload(taskId) {
    try { await fetch(apiUrl(`/download/${taskId}/cancel`), { method: 'POST' }); } catch { /* ignore */ }
  }

  async retryDownload(taskId) {
    try { await fetch(apiUrl(`/download/${taskId}/retry`), { method: 'POST' }); } catch { /* ignore */ }
  }

  async clearCompletedDownloads() {
    try { await fetch(apiUrl('/downloads/clear'), { method: 'POST' }); } catch { /* ignore */ }
  }

  /** URL the <audio> element can use to play a downloaded file offline. */
  localFileUrl(filePath) {
    return apiUrl(`/local?path=${encodeURIComponent(filePath)}`);
  }

  /** Open a file/folder path in the OS file manager.
   * In the EXE this opens Windows Explorer; in the browser it can't access the
   * filesystem, so it copies the path and reports that instead of doing nothing. */
  async openPath(path) {
    if (!path) return false;
    if (isTauri()) {
      const invoke = await getInvoke();
      if (invoke) {
        try { await invoke('open_file_location', { path }); return true; } catch { /* fall through */ }
      }
    }
    // Browser dev mode: no filesystem access. Copy the path so it's still useful.
    try {
      await navigator.clipboard.writeText(path);
      toast('Folder path copied (opening only works in the app)');
    } catch { /* clipboard blocked — ignore */ }
    return false;
  }

  /**
   * Get the status of all music sources.
   */
  async getSourcesStatus() {
    const response = await fetch(apiUrl('/sources/status'));
    if (!response.ok) {
      throw new Error(`Sources status failed: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get app settings (Tauri only — no-op in browser).
   */
  async getSettings() {
    if (isTauri()) {
      const invoke = await getInvoke();
      if (invoke) {
        return invoke('get_settings');
      }
    }
    // Return defaults in browser mode
    return {
      output_directory: null,
      max_bitrate: 256,
      preferred_source: null,
      theme: 'dark',
      auto_start_downloads: true,
    };
  }

  /**
   * Update app settings (Tauri only).
   */
  async updateSettings(settings) {
    if (isTauri()) {
      const invoke = await getInvoke();
      if (invoke) {
        return invoke('update_settings', { settings });
      }
    }
  }

  /**
   * Get backend status (Tauri only).
   */
  async getBackendStatus() {
    if (isTauri()) {
      const invoke = await getInvoke();
      if (invoke) {
        return invoke('get_backend_status');
      }
    }
    return { running: true, port: 8000 };
  }

  /**
   * Fetch lyrics (synced when available) for a track.
   * Returns { plain, synced: [{time, text}], source }. Never throws.
   */
  async getLyrics(title, artist, album = '', duration = 0) {
    try {
      const params = new URLSearchParams({ title, artist: artist || '' });
      if (album) params.set('album', album);
      if (duration) params.set('duration', String(Math.round(duration)));
      const response = await fetch(apiUrl(`/lyrics?${params.toString()}`));
      if (!response.ok) return { plain: '', synced: [], source: null };
      return await response.json();
    } catch {
      return { plain: '', synced: [], source: null };
    }
  }

  /**
   * Get the real bitrate + codec of a track's actual stream (via ffprobe).
   * Returns { bitrate_kbps, codec } — never throws.
   */
  async getStreamInfo(url, source, bitrate = 320) {
    try {
      const response = await fetch(
        apiUrl(`/stream_info?url=${encodeURIComponent(url)}&source=${encodeURIComponent(source)}&bitrate=${bitrate}`)
      );
      if (!response.ok) return { bitrate_kbps: null, codec: null };
      return await response.json();
    } catch {
      return { bitrate_kbps: null, codec: null };
    }
  }

  /**
   * Check whether the backend can actually reach the internet.
   * Returns true if online, false if offline. Never throws.
   */
  async checkConnectivity() {
    try {
      const response = await fetch(apiUrl('/connectivity'), { method: 'GET' });
      if (!response.ok) return true; // assume online if probe endpoint errors
      const data = await response.json();
      return data.online !== false;
    } catch {
      // If we can't even reach our own backend, treat as offline
      return false;
    }
  }

  // In-memory artwork cache to avoid duplicate API calls
  _artworkCache = new Map();

  /**
   * Fetch artwork URL from iTunes for a track missing cover art.
   * Results are cached in memory AND localStorage so covers persist across
   * reloads and remain available even when offline.
   */
  async fetchArtwork(title, artist) {
    const cacheKey = `${title}|${artist}`.toLowerCase();

    // 1. In-memory cache
    if (this._artworkCache.has(cacheKey)) {
      return this._artworkCache.get(cacheKey);
    }

    // 2. Persistent localStorage cache
    try {
      const persisted = JSON.parse(localStorage.getItem('artworkCache') || '{}');
      if (persisted[cacheKey]) {
        this._artworkCache.set(cacheKey, persisted[cacheKey]);
        return persisted[cacheKey];
      }
    } catch { /* ignore corrupt cache */ }

    // 3. Fetch from backend (requires internet)
    try {
      const response = await fetch(
        apiUrl(`/artwork?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist || '')}`)
      );
      if (!response.ok) return '';
      const data = await response.json();
      const url = data.artwork_url || '';
      if (url) {
        this._artworkCache.set(cacheKey, url);
        this._persistArtwork(cacheKey, url);
      }
      return url;
    } catch {
      return '';
    }
  }

  /** Persist an artwork URL to localStorage with a size cap. */
  _persistArtwork(key, url) {
    try {
      const persisted = JSON.parse(localStorage.getItem('artworkCache') || '{}');
      persisted[key] = url;
      // Cap the cache at 500 entries (drop oldest by insertion order)
      const keys = Object.keys(persisted);
      if (keys.length > 500) {
        for (const k of keys.slice(0, keys.length - 500)) delete persisted[k];
      }
      localStorage.setItem('artworkCache', JSON.stringify(persisted));
    } catch { /* storage full or unavailable — ignore */ }
  }

  /**
   * Fetch ~12 similar playable tracks for autoplay/radio, seeded from a
   * title+artist. Returns an array of track objects (may be empty). Never throws.
   */
  async getRadio(title, artist) {
    try {
      const params = new URLSearchParams({ title: title || '', artist: artist || '' });
      const response = await fetch(apiUrl(`/radio?${params.toString()}`));
      if (!response.ok) return [];
      const data = await response.json();
      return data.tracks || [];
    } catch {
      return [];
    }
  }

  /**
   * Fetch a rich artist profile (image, bio, genre, listeners, top songs,
   * albums, similar artists). Returns the profile object or null. Never throws.
   */
  async getArtist(name) {
    try {
      const r = await fetch(apiUrl(`/artist?name=${encodeURIComponent(name || '')}`));
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  /**
   * Search for real artists (Deezer artist index) for the search page's
   * Artists section. Returns [{name, image, fans}] — never throws.
   */
  async searchArtists(query) {
    try {
      const r = await fetch(apiUrl(`/search/artists?q=${encodeURIComponent(query || '')}`));
      if (!r.ok) return [];
      const data = await r.json();
      return data.artists || [];
    } catch {
      return [];
    }
  }

  /**
   * Search for real albums (JioSaavn album search + iTunes) for the search
   * page's Albums section. Returns [{name, artist, image, album_id, perma_url,
   * year}] — never throws.
   */
  async searchAlbums(query) {
    try {
      const r = await fetch(apiUrl(`/search/albums?q=${encodeURIComponent(query || '')}`));
      if (!r.ok) return [];
      const data = await r.json();
      return data.albums || [];
    } catch {
      return [];
    }
  }

  /**
   * Fetch an album profile with a playable tracklist. Returns the profile
   * object or null. Never throws. `albumId` (a JioSaavn album id from a search
   * card) resolves the EXACT release, bypassing name guessing.
   */
  async getAlbum(name, artist = '', songUrl = '', albumId = '') {
    try {
      const params = new URLSearchParams({ name: name || '', artist: artist || '' });
      if (songUrl) params.set('song_url', songUrl);
      if (albumId) params.set('album_id', albumId);
      const r = await fetch(apiUrl(`/album?${params.toString()}`));
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  /**
   * Batch-enrich tracks with clean metadata (artist, album, artwork, release
   * date, genre) from iTunes. Returns an array aligned with the input order;
   * each entry is an enrichment object or null. Never throws.
   */
  async enrichBatch(tracks) {
    try {
      const payload = {
        tracks: tracks.map(t => ({
          title: t.title || '',
          artist: t.artist || '',
          isrc: t.isrc || null,
          duration_ms: t.duration_ms || null,
        })),
      };
      const response = await fetch(apiUrl('/enrich'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) return tracks.map(() => null);
      const data = await response.json();
      return data.results || tracks.map(() => null);
    } catch {
      return tracks.map(() => null);
    }
  }
  /**
   * Dynamic Home feed rows (trending, new releases, charts, top playlists).
   * Returns { rows: [{title, items}] } — never throws.
   */
  async getHome(language = 'hindi,english') {
    try {
      const r = await fetch(apiUrl(`/home?language=${encodeURIComponent(language)}`));
      if (!r.ok) return { rows: [] };
      return await r.json();
    } catch {
      return { rows: [] };
    }
  }

  /**
   * Resolve a JioSaavn playlist/chart (by perma_url) to a playable,
   * album-shaped tracklist. Returns the profile object or null. Never throws.
   */
  async getPlaylist(url) {
    try {
      const r = await fetch(apiUrl(`/playlist?url=${encodeURIComponent(url || '')}`));
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  /**
   * Browse/genre tiles — curated JioSaavn featured playlists. Each tile is a
   * playlist openable via getPlaylist. Returns { tiles: [...] } — never throws.
   */
  async getGenres(language = 'hindi,english') {
    try {
      const r = await fetch(apiUrl(`/genres?language=${encodeURIComponent(language)}`));
      if (!r.ok) return { tiles: [] };
      return await r.json();
    } catch {
      return { tiles: [] };
    }
  }

  /**
   * YouTube connection (opt-in). Status / connect (pick a browser to read
   * login cookies from) / disconnect. All never throw → safe for Settings UI.
   */
  async youtubeStatus() {
    try {
      const r = await fetch(apiUrl('/youtube/status'));
      if (!r.ok) return { connected: false, browser: null, browsers: [] };
      return await r.json();
    } catch {
      return { connected: false, browser: null, browsers: [] };
    }
  }

  async youtubeConnect(browser) {
    try {
      const r = await fetch(apiUrl('/youtube/connect'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ browser }),
      });
      if (!r.ok) return { connected: false, error: `Connect failed: ${r.statusText}` };
      return await r.json();
    } catch (e) {
      return { connected: false, error: String(e) };
    }
  }

  /** Import a cookies.txt exported from a signed-in YouTube session. */
  async youtubeConnectFile(content) {
    try {
      const r = await fetch(apiUrl('/youtube/connect_file'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!r.ok) return { connected: false, error: `Import failed: ${r.statusText}` };
      return await r.json();
    } catch (e) {
      return { connected: false, error: String(e) };
    }
  }

  async youtubeDisconnect() {
    try {
      await fetch(apiUrl('/youtube/disconnect'), { method: 'POST' });
    } catch { /* ignore */ }
    return { connected: false };
  }
}

export const api = new ApiClient();