import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Music, Heart, Plus, Download, Check, Mic2, MoreHorizontal } from 'lucide-react';
import { usePlayer } from '../store/PlayerContext';
import { cleanText, getBestArtworkUrl, getPlayableSource, normalizeTrack, readPlaylists, writePlaylists, getTrackId, splitArtists, jiosaavnSongUrl } from '../utils/tracks';
import { useAppSettings } from '../utils/settings';
import { useDownloads } from '../store/DownloadsContext';
import { useOfflineTracks, isDownloaded } from '../utils/downloads';
import { useLikedSongs, toggleLiked } from '../utils/likes';
import { useTrackMenu } from '../utils/useTrackMenu';
import { api } from '../api';
import { FastAverageColor } from 'fast-average-color';

const SOURCE_COLORS = {
  jiosaavn: { bg: 'bg-green-600/20', text: 'text-green-400', label: 'JioSaavn' },
  youtube: { bg: 'bg-red-600/20', text: 'text-red-400', label: 'YouTube' },
  youtube_music: { bg: 'bg-red-600/20', text: 'text-red-400', label: 'YouTube Music' },
  soundcloud: { bg: 'bg-orange-600/20', text: 'text-orange-400', label: 'SoundCloud' },
};

// Per-session lyrics cache keyed by track id, so reopening the panel or
// replaying a song is instant (no refetch). Lyrics don't change.
const _lyricsCache = new Map();

export function NowPlayingPanel({ onClose, onLikeChange, onOpenArtist, onOpenAlbum }) {
  const { currentTrack, queue, duration, progress, seek, playTrack, setQueue } = usePlayer();
  const { showSourceBadge } = useAppSettings();
  const { startDownload } = useDownloads();
  useOfflineTracks(); // re-render when the offline registry changes
  const downloaded = currentTrack ? isDownloaded(currentTrack) : false;
  const [bgGradient, setBgGradient] = useState('rgb(18, 18, 18)');
  const likedSongs = useLikedSongs();
  const liked = currentTrack ? likedSongs.some(t => cleanText(t.title) === cleanText(currentTrack.title) && cleanText(t.artist) === cleanText(currentTrack.artist)) : false;
  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false); // lyrics collapsed by default
  const [playlists, setPlaylists] = useState([]);
  const [lyrics, setLyrics] = useState({ plain: '', synced: [], loading: true });
  // Shared track menu (same menu as search items) for the queue rows.
  const { openMenu, menuElement } = useTrackMenu({ onLibraryChange: onLikeChange, onOpenArtist, onOpenAlbum });
  const titleRef = useRef(null);
  const playlistMenuRef = useRef(null);
  const lyricsBoxRef = useRef(null);
  // ─── Resizable panel width ──────────────────────────────────────────────
  // Long multi-artist credits were clipped by the fixed width; let the user
  // drag the left edge to widen the panel. Width persists across sessions.
  const PANEL_MIN = 320, PANEL_MAX = 640;
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('nowPlayingWidth') || '', 10);
    return saved >= PANEL_MIN && saved <= PANEL_MAX ? saved : 360;
  });
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;

  const startResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidthRef.current;
    const onMove = (ev) => {
      // Panel sits on the right, so dragging its left edge leftward widens it.
      const w = Math.max(PANEL_MIN, Math.min(PANEL_MAX, startW + (startX - ev.clientX)));
      setPanelWidth(w);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      try { localStorage.setItem('nowPlayingWidth', String(panelWidthRef.current)); } catch { /* ignore */ }
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const activeLineRef = useRef(null);
  const [needsMarquee, setNeedsMarquee] = useState(false);

  // Latest duration without forcing the lyrics effect to re-run on every tick.
  const durationRef = useRef(duration);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  // Determine the currently-active synced lyric line from playback progress.
  // useMemo ensures we only trigger downstream effects when the idx ACTUALLY changes,
  // not on every 250ms progress tick (which would be ~4 re-renders/sec for nothing).
  const activeLineIdx = useMemo(() => {
    if (!lyrics.synced || lyrics.synced.length === 0 || progress <= 0) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.synced.length; i++) {
      if (lyrics.synced[i].time <= progress + 0.2) idx = i;
      else break;
    }
    return idx;
  }, [lyrics.synced, progress]);

  // Smooth scroll — using requestAnimationFrame to avoid layout thrashing.
  // Only scrolls when activeLineIdx actually changes (not on every progress tick).
  const prevActiveRef = useRef(-1);
  useEffect(() => {
    if (activeLineIdx === prevActiveRef.current) return;
    prevActiveRef.current = activeLineIdx;
    if (!activeLineRef.current || !lyricsBoxRef.current) return;
    const box = lyricsBoxRef.current;
    const line = activeLineRef.current;
    requestAnimationFrame(() => {
      const target = line.offsetTop - box.offsetTop - box.clientHeight * 0.35;
      box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    });
  }, [activeLineIdx]);

  // Extract dominant color for animated gradient
  useEffect(() => {
    const artworkUrl = getBestArtworkUrl(currentTrack);
    if (!artworkUrl) {
      setBgGradient('rgb(18, 18, 18)');
      return;
    }

    const fac = new FastAverageColor();
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = artworkUrl;

    img.onload = () => {
      try {
        const color = fac.getColor(img);
        const [r, g, b] = color.value;
        setBgGradient(`rgb(${r}, ${g}, ${b})`);
      } catch {
        setBgGradient('rgb(83, 83, 83)');
      }
    };

    img.onerror = () => setBgGradient('rgb(83, 83, 83)');
  }, [currentTrack]);

  // Check if title needs marquee
  useEffect(() => {
    if (titleRef.current) {
      setNeedsMarquee(titleRef.current.scrollWidth > titleRef.current.clientWidth);
    }
  }, [currentTrack?.title]);

  // Check liked status
  // (liked state is derived from the reactive likes store above — no effect needed)

  // Fetch lyrics whenever the track changes. The backend is reliable + cached,
  // so one call is enough — no artificial delays. Per-track client cache makes
  // reopening the panel / replaying instant.
  useEffect(() => {
    if (!currentTrack) { setLyrics({ plain: '', synced: [], loading: false }); return; }
    const id = getTrackId(currentTrack);

    const cached = _lyricsCache.get(id);
    if (cached) { setLyrics({ ...cached, loading: false }); return; }

    let cancelled = false;
    setLyrics({ plain: '', synced: [], loading: true });

    // Brief delay lets the audio element report duration (helps disambiguate
    // same-titled songs); the backend also works fine with duration=0.
    const timer = setTimeout(async () => {
      // Prefer the live audio duration; fall back to the catalog duration_ms
      // (from JioSaavn, our actual stream source — authoritative and available
      // immediately) so lrclib can match the closest-timed version even before
      // the <audio> element has loaded its metadata.
      const durSec = Math.round(
        durationRef.current || (currentTrack.duration_ms ? currentTrack.duration_ms / 1000 : 0)
      );
      const res = await api.getLyrics(
        cleanText(currentTrack.title),
        cleanText(currentTrack.artist),
        cleanText(currentTrack.album),
        durSec,
      );
      if (cancelled) return;
      const out = { plain: res.plain || '', synced: res.synced || [] };
      if (out.synced.length || out.plain) _lyricsCache.set(id, out);
      setLyrics({ ...out, loading: false });
    }, 600);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [currentTrack]);

  // Load playlists
  useEffect(() => {
    setPlaylists(readPlaylists());
  }, [showPlaylistMenu]);

  // Close playlist dropdown on outside click
  useEffect(() => {
    if (!showPlaylistMenu) return;
    const handleClick = (e) => {
      if (playlistMenuRef.current && !playlistMenuRef.current.contains(e.target)) {
        setShowPlaylistMenu(false);
      }
    };
    // Microtask delay so the opening click doesn't immediately close
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [showPlaylistMenu]);

  if (!currentTrack) return null;

  const source = getPlayableSource(currentTrack);
  const artworkUrl = getBestArtworkUrl(currentTrack);
  const sourceInfo = SOURCE_COLORS[source] || { bg: 'bg-white/10', text: 'text-white/60', label: source || 'Unknown' };
  // Whether this track has any lyrics (synced or plain) — gates the lyrics
  // toggle button (instrumentals like film scores have none, so it's disabled).
  const hasLyrics = lyrics.synced.length > 0 || !!lyrics.plain;

  const toggleLike = () => {
    toggleLiked(currentTrack);
    if (onLikeChange) onLikeChange();
  };

  const addToPlaylist = (playlistId) => {
    const stored = readPlaylists();
    const updated = stored.map(p => {
      if (p.id === playlistId) {
        const exists = (p.tracks || []).some(t => cleanText(t.title) === cleanText(currentTrack.title) && cleanText(t.artist) === cleanText(currentTrack.artist));
        if (!exists) {
          return { ...p, tracks: [...(p.tracks || []), normalizeTrack(currentTrack)] };
        }
      }
      return p;
    });
    writePlaylists(updated);
    setShowPlaylistMenu(false);
    if (onLikeChange) onLikeChange();
  };

  return (
    <div
      className="rounded-lg m-2 ml-0 flex flex-col overflow-hidden shrink-0 relative"
      style={{
        width: `${panelWidth}px`,
        background: `linear-gradient(${bgGradient} 0%, rgb(18, 18, 18) 100%)`,
        transition: 'background 1s ease',
      }}
    >
      {/* Resize handle — drag the left edge to widen/narrow the panel */}
      <div
        onMouseDown={startResize}
        className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize z-30 group/resize"
        title="Drag to resize"
      >
        <div className="h-full w-full group-hover/resize:bg-spotify-essential-bright-accent/40 transition-colors" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-bold text-white truncate">
          {cleanText(currentTrack.album) || cleanText(currentTrack.title)}
        </span>
        <button
          onClick={onClose}
          className="text-spotify-text-subdued hover:text-white transition-colors p-1 rounded-full hover:bg-white/10"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {/* Album Art */}
        <div className="mb-5">
          {artworkUrl ? (
            <img
              src={artworkUrl}
              alt={cleanText(currentTrack.title)}
              className="w-full aspect-square object-cover rounded-xl shadow-2xl"
            />
          ) : (
            <div className="w-full aspect-square bg-spotify-elevated-highlight rounded-xl flex items-center justify-center">
              <Music className="w-16 h-16 text-spotify-text-subdued" />
            </div>
          )}
        </div>

        {/* Track Info — title → album, each artist → profile */}
        <div className="mb-3">
          <div className="overflow-hidden" ref={titleRef}>
            {needsMarquee ? (
              <div className="animate-marquee whitespace-nowrap">
                <span className="text-xl font-bold text-white mr-16">{cleanText(currentTrack.title)}</span>
                <span className="text-xl font-bold text-white">{cleanText(currentTrack.title)}</span>
              </div>
            ) : (
              <h2
                onClick={() => { const al = cleanText(currentTrack.album); if (al && onOpenAlbum) onOpenAlbum(al, splitArtists(currentTrack.artist)[0] || '', jiosaavnSongUrl(currentTrack)); }}
                className={`text-xl font-bold text-white leading-tight truncate ${cleanText(currentTrack.album) && onOpenAlbum ? 'hover:underline cursor-pointer' : ''}`}
                title={cleanText(currentTrack.title)}
              >
                {cleanText(currentTrack.title)}
              </h2>
            )}
          </div>
          <p className="text-sm text-spotify-text-subdued mt-0.5 truncate" title={cleanText(currentTrack.artist)}>
            {splitArtists(currentTrack.artist).map((name, i) => (
              <span key={i}>
                {i > 0 && ', '}
                <span
                  onClick={() => onOpenArtist && onOpenArtist(name)}
                  className={onOpenArtist ? 'hover:underline hover:text-white cursor-pointer' : ''}
                >
                  {name}
                </span>
              </span>
            ))}
          </p>
        </div>

        {/* Actions row: download · like · add-to-playlist · lyrics toggle */}
        <div className="flex items-center gap-1 mb-5 relative" ref={playlistMenuRef}>
          <button
            onClick={() => { if (!downloaded) startDownload(currentTrack); }}
            title={downloaded ? 'Downloaded' : 'Download'}
            className={`p-2 rounded-full transition-all ${downloaded ? 'text-spotify-essential-bright-accent' : 'text-spotify-text-subdued hover:text-white hover:bg-white/10'}`}
          >
            {downloaded ? <Check className="w-5 h-5" /> : <Download className="w-5 h-5" />}
          </button>
          <button
            onClick={toggleLike}
            title={liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
            className={`p-2 rounded-full transition-all ${liked ? 'text-spotify-essential-bright-accent' : 'text-spotify-text-subdued hover:text-white hover:bg-white/10'}`}
          >
            <Heart className="w-5 h-5" fill={liked ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={() => setShowPlaylistMenu(v => !v)}
            title="Add to playlist"
            className={`p-2 rounded-full transition-all ${showPlaylistMenu ? 'text-white bg-white/10' : 'text-spotify-text-subdued hover:text-white hover:bg-white/10'}`}
          >
            <Plus className="w-5 h-5" />
          </button>
          <button
            onClick={() => { if (hasLyrics) setShowLyrics(v => !v); }}
            disabled={!hasLyrics}
            title={hasLyrics ? (showLyrics ? 'Hide lyrics' : 'Show lyrics') : 'No lyrics for this track'}
            className={`p-2 rounded-full transition-all ${!hasLyrics ? 'text-white/20 cursor-default' : showLyrics ? 'text-spotify-essential-bright-accent' : 'text-spotify-text-subdued hover:text-white hover:bg-white/10'}`}
          >
            <Mic2 className="w-5 h-5" />
          </button>

          {showSourceBadge && (
            <span className={`ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${sourceInfo.bg} ${sourceInfo.text}`}>
              {sourceInfo.label}
            </span>
          )}

          {/* Add-to-playlist dropdown */}
          {showPlaylistMenu && (
            <div className="absolute top-full left-0 mt-2 bg-[#282828] rounded-lg shadow-2xl border border-white/10 py-1 min-w-[200px] z-20 max-h-48 overflow-y-auto">
              {playlists.length === 0 ? (
                <div className="px-3 py-2.5 text-sm text-spotify-text-subdued">No playlists yet</div>
              ) : (
                playlists.map(pl => (
                  <button
                    key={pl.id}
                    onClick={() => addToPlaylist(pl.id)}
                    className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-white/90 hover:bg-white/10 transition-colors text-left"
                  >
                    <Music className="w-3.5 h-3.5 text-spotify-text-subdued" />
                    <span className="truncate">{pl.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Lyrics — collapsed by default, toggled via the mic button above */}
        {showLyrics && hasLyrics && (
          <div className="mb-6">
            <h3 className="text-xs font-bold text-white uppercase tracking-widest mb-3">Lyrics</h3>
            {lyrics.synced.length > 0 ? (
              <div
                ref={lyricsBoxRef}
                className="max-h-64 overflow-y-auto pr-1 scroll-smooth lyrics-container"
                style={{ scrollBehavior: 'smooth' }}
              >
                {lyrics.synced.map((line, i) => {
                  const isActive = i === activeLineIdx;
                  const isPast = activeLineIdx >= 0 && i < activeLineIdx;
                  return (
                    <p
                      key={i}
                      ref={isActive ? activeLineRef : null}
                      onClick={() => line.time != null && seek(line.time)}
                      className="lyric-line cursor-pointer select-none"
                      style={{
                        color: isActive ? '#ffffff' : isPast ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.55)',
                        fontWeight: isActive ? 600 : 400,
                        fontSize: '0.95rem',
                        lineHeight: '1.8',
                        padding: '3px 0',
                        transformOrigin: 'left center',
                        transform: isActive ? 'scale(1.04)' : 'scale(1)',
                        opacity: isActive ? 1 : isPast ? 0.55 : 0.75,
                        transition: 'color 0.5s cubic-bezier(0.4,0,0.2,1), opacity 0.5s cubic-bezier(0.4,0,0.2,1), transform 0.5s cubic-bezier(0.4,0,0.2,1)',
                        willChange: 'transform, opacity',
                      }}
                    >
                      {line.text || '♪'}
                    </p>
                  );
                })}
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto pr-1">
                <p className="text-sm text-spotify-text-subdued whitespace-pre-line leading-relaxed">{lyrics.plain}</p>
              </div>
            )}
          </div>
        )}

        {/* Credits */}
        <div className="mb-6 bg-white/5 rounded-lg p-4">
          <h3 className="text-xs font-bold text-white uppercase tracking-widest mb-3">Credits</h3>
          <div className="space-y-3">
            {splitArtists(currentTrack.artist).map((artistName, i) => (
              <button
                key={i}
                onClick={() => onOpenArtist && onOpenArtist(artistName)}
                disabled={!onOpenArtist}
                className="block text-left group/credit disabled:cursor-default"
              >
                <p className="text-sm font-medium text-white group-hover/credit:underline">{artistName}</p>
                <p className="text-xs text-spotify-text-subdued">{i === 0 ? 'Main Artist' : 'Artist'}</p>
              </button>
            ))}
            {currentTrack.album && (
              <button
                onClick={() => onOpenAlbum && onOpenAlbum(cleanText(currentTrack.album), splitArtists(currentTrack.artist)[0] || '', jiosaavnSongUrl(currentTrack))}
                disabled={!onOpenAlbum}
                className="block text-left group/credit disabled:cursor-default"
              >
                <p className="text-sm font-medium text-white group-hover/credit:underline">{cleanText(currentTrack.album)}</p>
                <p className="text-xs text-spotify-text-subdued">Album</p>
              </button>
            )}
          </div>
        </div>

        {/* Next in queue — clickable, with the same menu as search items */}
        {queue.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-widest mb-3">Next in queue</h3>
            <div className="space-y-1">
              {queue.slice(0, 3).map((track, idx) => (
                <div
                  key={idx}
                  onClick={() => { const remaining = queue.filter((_, i) => i !== idx); playTrack(track); setQueue(remaining); }}
                  onContextMenu={(e) => openMenu(e, track)}
                  className="group flex items-center gap-3 p-2 rounded-md hover:bg-white/10 transition-colors cursor-pointer"
                >
                  {getBestArtworkUrl(track) ? (
                    <img src={getBestArtworkUrl(track)} className="w-10 h-10 object-cover rounded shadow-sm shrink-0" alt="" />
                  ) : (
                    <div className="w-10 h-10 bg-spotify-elevated-highlight rounded flex items-center justify-center shrink-0">
                      <Music className="w-4 h-4 text-spotify-text-subdued" />
                    </div>
                  )}
                  <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-medium text-white truncate">{cleanText(track.title)}</p>
                    <p className="text-xs text-spotify-text-subdued truncate">{cleanText(track.artist)}</p>
                  </div>
                  <button
                    onClick={(e) => openMenu(e, track)}
                    className="shrink-0 text-spotify-text-subdued hover:text-white p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="More"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {menuElement}
    </div>
  );
}
