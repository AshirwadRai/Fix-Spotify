import { createContext, useState, useContext, useRef, useEffect, useCallback } from 'react';
import { getPlayableSource, getPlayableSources, normalizeTrack, writeStoredTracks, getBestArtworkUrl, cleanText, getTrackId, isPlayableTrack, applyEnrichment } from '../utils/tracks';
import { readAppSettings, qualityToBitrate } from '../utils/settings';
import { apiUrl } from '../utils/config';
import { getOfflineEntry, removeOfflineEntry } from '../utils/downloads';
import { api } from '../api';

const PlayerContext = createContext();

function getAppSettings() {
  return readAppSettings();
}

// ── Resume state ────────────────────────────────────────────────────────────
// Persist the last track + timestamp so reopening the app lands exactly where
// the user left off (paused). Kept tiny and separate from Recently Played.
const RESUME_KEY = 'resumeState';

function saveResumeState(track, position) {
  try {
    if (!track) return;
    localStorage.setItem(RESUME_KEY, JSON.stringify({
      track,
      position: Math.max(0, Math.floor(position || 0)),
      savedAt: Date.now(),
    }));
  } catch { /* storage full / unavailable — ignore */ }
}

function readResumeState() {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.track ? s : null;
  } catch {
    return null;
  }
}

/**
 * A track is playable if it has a streaming source OR a file on disk.
 *
 * `isPlayableTrack`/`playableTracks` only know about streaming sources, so they
 * discard downloaded tracks that were rebuilt from disk (mergeScannedTracks
 * gives those `sources: {}`). Filtering a queue with them silently dropped
 * every offline track — so a downloaded album played nothing offline.
 *
 * These two live here rather than in utils/tracks.js because downloads.js
 * already imports from tracks.js; putting them there would be a cycle.
 */
function isPlayableOrOffline(track) {
  return !!getPlayableSource(track) || !!getOfflineEntry(track);
}

function queueableTracks(tracks = []) {
  return tracks.map(normalizeTrack).filter(isPlayableOrOffline);
}

/** Build the proxy stream URL honouring the user's audio-quality setting. */
function buildProxyUrl(streamUrl, source) {
  const bitrate = qualityToBitrate(readAppSettings().audioQuality);
  return apiUrl(`/proxy_stream?url=${encodeURIComponent(streamUrl)}&source=${encodeURIComponent(source)}&bitrate=${bitrate}`);
}

/** Loose same-song check used by the on-failure source search, so the safety
 * net can never play a WRONG song: titles must match (one contains the other)
 * AND the artists must share a word (when both are known). */
function _normTitle(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function matchesTrack(a, b) {
  const ta = _normTitle(a?.title), tb = _normTitle(b?.title);
  if (!ta || !tb) return false;
  if (!(ta === tb || ta.includes(tb) || tb.includes(ta))) return false;
  const wa = new Set(cleanText(a?.artist).toLowerCase().split(/[\s,&]+/).filter(w => w.length >= 3));
  const wb = cleanText(b?.artist).toLowerCase().split(/[\s,&]+/).filter(w => w.length >= 3);
  if (wa.size === 0 || wb.length === 0) return true; // can't compare → trust the title match
  return wb.some(w => wa.has(w));
}

/** SAFETY NET (only runs on actual playback failure): a single-source track
 * (e.g. a Home/JioSaavn card that carries only `jiosaavn`) has no built-in
 * fallback, so when its source dies we search ALL sources once for the same
 * song and return any playable source we haven't tried. Returns [] if nothing
 * trustworthy is found. The happy path never calls this → zero added latency. */
async function resolveAlternateSources(track, tried) {
  try {
    const q = `${cleanText(track?.title)} ${cleanText(track?.artist)}`.trim();
    if (!q) return [];
    const data = await api.search(q, { limit: 5 });
    const results = (data?.results || []).map(normalizeTrack).filter(Boolean);
    for (const r of results) {
      if (!matchesTrack(track, r)) continue;
      const srcs = getPlayableSources(r).filter(s => s.url && !tried.has(s.source));
      if (srcs.length > 0) return srcs;
    }
    return [];
  } catch {
    return [];
  }
}

// Fisher-Yates: a new shuffled copy of an array (does not mutate input).
function shuffleArray(arr) {
  const a = [...(arr || [])];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function PlayerProvider({ children }) {
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState(null);
  const [volume, setVolume] = useState(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queue, setQueue] = useState([]);
  const [history, setHistory] = useState([]); // tracks we've already played
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off'); // 'off' | 'all' | 'one'
  const [streamQuality, setStreamQuality] = useState(null); // { bitrate, codec }
  
  const audioRef = useRef(new Audio());
  audioRef.current.preload = 'auto';

  // Second audio element for crossfade
  const crossfadeAudioRef = useRef(new Audio());
  crossfadeAudioRef.current.preload = 'auto';
  const crossfadeTimerRef = useRef(null);
  const crossfadingRef = useRef(false);

  // Web Audio graph for volume normalization (built lazily, only if enabled)
  const audioCtxRef = useRef(null);
  const mainChainRef = useRef(null);
  const crossfadeChainRef = useRef(null);

  // Refs to break stale closure chains — event listeners always read current values
  const playNextRef = useRef(null);
  const repeatRef = useRef(repeat);
  const volumeRef = useRef(volume);
  const currentTrackRef = useRef(currentTrack);
  const queueRef = useRef(queue);
  const shuffleRef = useRef(shuffle);
  const historyRef = useRef(history);
  // Upcoming queue in natural (unshuffled) order, captured when shuffle turns
  // on so toggling it off can restore the remaining tracks' original order.
  const naturalOrderRef = useRef(null);
  const radioLoadingRef = useRef(false);
  // Cross-source playback fallback: { sources:[{source,url}], idx } for the
  // track currently loading. handleError advances to the next source on failure.
  const playAttemptRef = useRef(null);
  // Consecutive fully-failed tracks (all sources dead). Caps auto-skip so a
  // dead queue doesn't loop forever; reset on any successful play.
  const autoSkipRef = useRef(0);
  // Seconds to seek to once the next source is buffered. Set when RESTORING the
  // last session (see restore effect); applied in handleCanPlay, then cleared.
  const pendingSeekRef = useRef(0);
  // Throttle for persisting resume state during playback (localStorage write).
  const lastSaveRef = useRef(0);

  useEffect(() => { repeatRef.current = repeat; }, [repeat]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { shuffleRef.current = shuffle; }, [shuffle]);
  useEffect(() => { historyRef.current = history; }, [history]);

  // Initialize audio element event listeners — runs ONCE
  useEffect(() => {
    const audio = audioRef.current;
    
    const handleTimeUpdate = () => {
      setProgress(audio.currentTime);

      // Persist the resume point at most once every 5s so a reopen lands on the
      // same song at the same timestamp. Cheap and throttled — not every tick.
      const now = Date.now();
      if (now - lastSaveRef.current > 5000 && currentTrackRef.current && audio.currentTime > 0) {
        lastSaveRef.current = now;
        saveResumeState(currentTrackRef.current, audio.currentTime);
      }

      // ─── Crossfade check ──────────────────────────────────────
      const settings = getAppSettings();
      const crossfadeDuration = settings.crossfadeDuration || 0;
      if (
        crossfadeDuration > 0 &&
        !crossfadingRef.current &&
        audio.duration &&
        isFinite(audio.duration) &&
        audio.duration - audio.currentTime <= crossfadeDuration &&
        audio.duration - audio.currentTime > 0.5 && // Don't trigger too close to end
        queueRef.current.length > 0
      ) {
        startCrossfade(crossfadeDuration);
      }
    };
    const handleDurationChange = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    const handleEnded = () => {
      if (crossfadingRef.current) {
        // Crossfade already handled the transition
        return;
      }
      if (repeatRef.current === 'one') {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        // Always call the LATEST playNext via ref — no stale closures
        playNextRef.current?.();
      }
    };
    const handleError = () => {
      // Cross-source fallback: the current source failed to load (dead / DRM /
      // geo-blocked). If this track has another source, try it before erroring.
      const att = playAttemptRef.current;
      if (att && att.idx + 1 < att.sources.length) {
        const failed = att.sources[att.idx];
        // A downloaded file that 404s (deleted/moved) shouldn't dead-end: fall
        // back to streaming AND drop the stale registry entry so the UI stops
        // marking the track "downloaded".
        if (failed?.local && currentTrackRef.current) {
          removeOfflineEntry(currentTrackRef.current);
        }
        att.idx += 1;
        const c = att.sources[att.idx];
        try {
          audio.src = c.local ? api.localFileUrl(c.url) : buildProxyUrl(c.url, c.source);
          audio.volume = volumeRef.current;
          audio.play().catch(() => {});
          return; // trying the next source — don't surface an error yet
        } catch { /* fall through to the normal error path */ }
      }
      // SAFETY NET: every KNOWN source is dead. Single-source tracks (Home /
      // artist / album / playlist cards carry only JioSaavn) have nothing to
      // fall back to. ONCE per track, search all sources for the same song and
      // try any we haven't yet. Only fires on real failure → the common case
      // pays nothing. Skipped for offline-only attempts with no track context.
      if (att && !att.searched && currentTrackRef.current) {
        att.searched = true;
        const tried = new Set(att.sources.map(s => s.source));
        resolveAlternateSources(currentTrackRef.current, tried).then(found => {
          if (playAttemptRef.current !== att) return; // a new track started — abandon
          if (found.length > 0) {
            att.sources = att.sources.concat(found);
            att.idx += 1;
            const c = att.sources[att.idx];
            try {
              audio.src = buildProxyUrl(c.url, c.source);
              audio.volume = volumeRef.current;
              audio.play().catch(() => {});
              return; // found an alternate — give it a shot
            } catch { /* fall through to give up */ }
          }
          giveUp(att);
        });
        return; // wait for the async search before deciding to skip/error
      }
      giveUp(att);
    };
    // Final failure path: every source (and the search safety net) is exhausted.
    function giveUp(att) {
      playAttemptRef.current = null;
      // Rather than stall on an error, auto-skip to the next track — capped so a
      // fully-dead queue doesn't loop forever. `att` is only set for streamed
      // (non-offline) tracks, so offline files never trigger this.
      if (att && autoSkipRef.current < 5) {
        autoSkipRef.current += 1;
        setIsLoading(false);
        setIsPlaying(false);
        playNextRef.current?.();
        return;
      }
      console.error("Audio error:", audio.error);
      // Determine a meaningful error message based on the actual error code
      const err = audio.error;
      let message = 'Playback failed — try again';
      if (err) {
        switch (err.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            message = 'Playback was interrupted';
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            message = navigator.onLine
              ? 'Network error — the stream may be temporarily unavailable'
              : 'No internet connection — please reconnect to keep listening';
            break;
          case MediaError.MEDIA_ERR_DECODE:
            message = 'This track could not be decoded — try a different source';
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            message = 'This track format is not supported — try a different source';
            break;
          default:
            message = navigator.onLine
              ? 'Playback failed — try again or skip to next'
              : 'No internet connection — please reconnect to keep listening';
        }
      } else if (!navigator.onLine) {
        message = 'No internet connection — please reconnect to keep listening';
      }
      setPlaybackError(message);
      setIsPlaying(false);
      setIsLoading(false);
    }
    const handleCanPlay = () => {
      setIsLoading(false);
      setPlaybackError(null);
      // Restoring a session: jump to the saved timestamp once the stream can
      // play, then clear so normal playback isn't re-seeked.
      if (pendingSeekRef.current > 0) {
        try {
          audio.currentTime = pendingSeekRef.current;
          setProgress(pendingSeekRef.current);
        } catch { /* seek before seekable — ignore */ }
        pendingSeekRef.current = 0;
      }
    };
    const handleWaiting = () => setIsLoading(true);
    const handlePlaying = () => {
      setIsLoading(false);
      setIsPlaying(true);
      playAttemptRef.current = null; // a source succeeded — stop fallback
      autoSkipRef.current = 0;       // reset the dead-track skip cap
    };
    // Sync UI when audio is paused externally (earphones, OS media controls, etc.)
    const handlePause = () => {
      // Don't set isPlaying false during crossfade (we're fading out intentionally)
      if (!crossfadingRef.current) {
        setIsPlaying(false);
      }
      // Pausing is a natural save point for the resume timestamp.
      if (currentTrackRef.current && audio.currentTime > 0) {
        saveResumeState(currentTrackRef.current, audio.currentTime);
      }
    };
    
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('pause', handlePause);
    
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('pause', handlePause);
    };
  }, []); // empty deps — listeners never re-attached, refs handle freshness

  // ─── Volume normalization (Web Audio) ───────────────────────────────
  // Built lazily and ONLY when the user enables it, so the default path
  // never routes audio through Web Audio (zero risk of breaking playback).
  const buildAudioChain = useCallback((el, ctx) => {
    try {
      const source = ctx.createMediaElementSource(el);
      const compressor = ctx.createDynamicsCompressor();
      const gain = ctx.createGain();
      source.connect(compressor);
      compressor.connect(gain);
      gain.connect(ctx.destination);
      return { source, compressor, gain };
    } catch {
      return null;
    }
  }, []);

  const ensureAudioGraph = useCallback(() => {
    if (audioCtxRef.current) return true;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      mainChainRef.current = buildAudioChain(audioRef.current, ctx);
      crossfadeChainRef.current = buildAudioChain(crossfadeAudioRef.current, ctx);
      return true;
    } catch {
      return false;
    }
  }, [buildAudioChain]);

  const applyNormalization = useCallback((chain, enabled) => {
    if (!chain) return;
    const { compressor, gain } = chain;
    try {
      if (enabled) {
        compressor.threshold.value = -24;
        compressor.knee.value = 30;
        compressor.ratio.value = 12;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;
        gain.gain.value = 1.5; // makeup gain to compensate for compression
      } else {
        // Transparent pass-through
        compressor.threshold.value = 0;
        compressor.knee.value = 0;
        compressor.ratio.value = 1;
        compressor.attack.value = 0;
        compressor.release.value = 0;
        gain.gain.value = 1.0;
      }
    } catch { /* node params unavailable — ignore */ }
  }, []);

  const resumeAudioCtx = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const apply = () => {
      const enabled = !!readAppSettings().normalizeVolume;
      // If it's off and we never built the graph, do nothing (keep zero-risk path).
      if (!enabled && !audioCtxRef.current) return;
      if (!ensureAudioGraph()) return;
      resumeAudioCtx();
      applyNormalization(mainChainRef.current, enabled);
      applyNormalization(crossfadeChainRef.current, enabled);
    };
    apply();
    window.addEventListener('appsettingschange', apply);
    return () => window.removeEventListener('appsettingschange', apply);
  }, [ensureAudioGraph, applyNormalization, resumeAudioCtx]);

  // ─── Crossfade logic ────────────────────────────────────────────
  const startCrossfade = useCallback((crossfadeDuration) => {
    if (crossfadingRef.current) return;
    crossfadingRef.current = true;

    const currentAudio = audioRef.current;
    const nextAudio = crossfadeAudioRef.current;

    // Get the next track
    const currentQueue = queueRef.current;
    if (currentQueue.length === 0) {
      crossfadingRef.current = false;
      return;
    }

    // Queue is the play order (shuffle reorders it up front), so take the head.
    const nextTrack = currentQueue[0];
    const newQueue = currentQueue.slice(1);

    const source = getPlayableSource(nextTrack);
    const urlToStream = nextTrack?.sources?.[source]?.url;
    if (!urlToStream) {
      crossfadingRef.current = false;
      return;
    }

    const proxyUrl = buildProxyUrl(urlToStream, source);
    nextAudio.src = proxyUrl;
    nextAudio.volume = 0;
    nextAudio.play().catch(() => {
      crossfadingRef.current = false;
      return;
    });

    // Fade out current, fade in next
    const steps = 20;
    const interval = (crossfadeDuration * 1000) / steps;
    let step = 0;
    const startVolume = currentAudio.volume;

    if (crossfadeTimerRef.current) clearInterval(crossfadeTimerRef.current);

    crossfadeTimerRef.current = setInterval(() => {
      step++;
      const ratio = step / steps;

      // Fade out current
      currentAudio.volume = Math.max(0, startVolume * (1 - ratio));
      // Fade in next
      nextAudio.volume = Math.min(volumeRef.current, volumeRef.current * ratio);

      if (step >= steps) {
        clearInterval(crossfadeTimerRef.current);
        crossfadeTimerRef.current = null;

        // Swap: next becomes current
        currentAudio.pause();
        playAttemptRef.current = null; // crossfade controls the source now
        currentAudio.src = nextAudio.src;
        currentAudio.currentTime = nextAudio.currentTime;
        currentAudio.volume = volumeRef.current;
        currentAudio.play().catch(() => {});

        nextAudio.pause();
        nextAudio.src = '';

        // Update state
        if (currentTrackRef.current) {
          setHistory(prev => [currentTrackRef.current, ...prev.slice(0, 49)]);
        }
        setCurrentTrack(normalizeTrack(nextTrack));
        setQueue(newQueue);
        setProgress(0);
        setDuration(0);
        saveRecentlyPlayed(normalizeTrack(nextTrack));

        crossfadingRef.current = false;
      }
    }, interval);
  }, []); // no deps needed — uses refs for all mutable state

  // ─── MediaSession API ────────────────────────────────────────────────
  // Shows track info on OS lock-screen, taskbar, earphone displays, etc.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    const artworkUrl = getBestArtworkUrl(currentTrack);
    const artwork = artworkUrl ? [
      { src: artworkUrl, sizes: '512x512', type: 'image/jpeg' },
    ] : [];

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: cleanText(currentTrack.title) || 'Unknown',
        artist: cleanText(currentTrack.artist) || 'Unknown Artist',
        album: cleanText(currentTrack.album) || '',
        artwork,
      });
    } catch {
      // MediaMetadata not supported in some browsers
    }

    // Wire up hardware buttons
    const actions = {
      play: () => { audioRef.current.play().catch(() => {}); },
      pause: () => { audioRef.current.pause(); },
      previoustrack: () => { playPreviousRef.current?.(); },
      nexttrack: () => { playNextRef.current?.(); },
      seekto: (details) => {
        if (details.seekTime != null) {
          audioRef.current.currentTime = details.seekTime;
        }
      },
    };

    for (const [action, handler] of Object.entries(actions)) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Some actions not supported in all browsers
      }
    }
  }, [currentTrack]);

  // ─── Keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't capture when typing in inputs
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (currentTrackRef.current) {
            const audio = audioRef.current;
            if (audio.paused) {
              audio.play().catch(() => {});
            } else {
              audio.pause();
            }
          }
          break;
        case 'ArrowRight':
          if (e.shiftKey) {
            // Shift+Right = next track
            playNextRef.current?.();
          } else {
            // Right = seek forward 5s
            audioRef.current.currentTime = Math.min(
              audioRef.current.currentTime + 5,
              audioRef.current.duration || Infinity
            );
          }
          break;
        case 'ArrowLeft':
          if (e.shiftKey) {
            // Shift+Left = previous track
            playPreviousRef.current?.();
          } else {
            // Left = seek back 5s
            audioRef.current.currentTime = Math.max(audioRef.current.currentTime - 5, 0);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          { const newVol = Math.min(1, volumeRef.current + 0.05);
            audioRef.current.volume = newVol;
            setVolume(newVol);
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          { const newVol = Math.max(0, volumeRef.current - 0.05);
            audioRef.current.volume = newVol;
            setVolume(newVol);
          }
          break;
        case 'KeyM':
          // M = toggle mute
          if (audioRef.current.volume > 0) {
            audioRef.current._prevVolume = audioRef.current.volume;
            audioRef.current.volume = 0;
            setVolume(0);
          } else {
            const restored = audioRef.current._prevVolume || 1;
            audioRef.current.volume = restored;
            setVolume(restored);
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ─── Autoplay radio ──────────────────────────────────────────────────
  // Fetch songs similar to `seed`, normalized + tagged _autoplay, with tracks
  // we've already played/queued filtered out. Shared by the prefetch effect
  // and playNext's queue-exhausted fallback.
  const fetchRadioTracks = useCallback(async (seed) => {
    if (!seed) return [];
    const list = await api.getRadio(cleanText(seed.title), cleanText(seed.artist));
    if (!Array.isArray(list) || list.length === 0) return [];
    const seen = new Set();
    [currentTrackRef.current, ...queueRef.current, ...historyRef.current]
      .forEach(t => { if (t) seen.add(getTrackId(t)); });
    const out = [];
    for (const raw of list) {
      const t = normalizeTrack(raw);
      if (!t || !isPlayableTrack(t)) continue;
      const id = getTrackId(t);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ ...t, _autoplay: true });
    }
    return out;
  }, []);

  // When the queue runs low, top it up with similar songs so playback continues
  // endlessly — like Spotify. Suppressed when autoplay is off or repeat='all'.
  useEffect(() => {
    if (!currentTrack) return;
    if (queue.length >= 3) return;
    if (repeat === 'all') return;
    if (!readAppSettings().autoplay) return;
    if (radioLoadingRef.current) return;
    radioLoadingRef.current = true;
    fetchRadioTracks(currentTrack)
      .then(adds => { if (adds.length > 0) setQueue(q => [...q, ...adds]); })
      .finally(() => { radioLoadingRef.current = false; });
  }, [currentTrack, queue.length, repeat, fetchRadioTracks]);

  // ─── End-to-end metadata consistency ─────────────────────────────────
  // Enrich the playing track to FINAL clean metadata (clean artist/album,
  // hi-res cover, genre) so the player bar, Now-Playing panel, OS media
  // controls and recently-played all show exactly what a download embeds.
  // Runs on ANY currentTrack change (play / next / prev / radio / crossfade)
  // and only enriches once per track (the _enriched flag stops re-runs). Only
  // metadata is overlaid — the stream source/url is untouched, so audio never
  // reloads.
  useEffect(() => {
    if (!currentTrack || currentTrack._enriched) return;
    const target = currentTrack;
    let cancelled = false;
    api.enrichBatch([target]).then(arr => {
      const enr = Array.isArray(arr) ? arr[0] : null;
      if (cancelled || !enr) return;
      setCurrentTrack(prev =>
        prev && getTrackId(prev) === getTrackId(target) ? applyEnrichment(prev, enr) : prev
      );
      // Recently Played is saved at play-start (pre-enrichment, so a track whose
      // first source fails still gets recorded). Patch that snapshot with the
      // clean metadata so Home shows the enriched artist/album/cover too.
      try {
        const stored = JSON.parse(localStorage.getItem('recentlyPlayed') || '[]');
        const tid = getTrackId(target);
        let touched = false;
        const patched = stored.map(t => {
          if (!touched && getTrackId(t) === tid) { touched = true; return applyEnrichment(t, enr); }
          return t;
        });
        if (touched) writeStoredTracks('recentlyPlayed', patched, 20);
      } catch { /* best-effort */ }
    }).catch(() => { /* enrichment is best-effort */ });
    return () => { cancelled = true; };
  }, [currentTrack]);

  // ─── Live stream quality (real bitrate + codec via ffprobe) ──────────
  useEffect(() => {
    if (!currentTrack) { setStreamQuality(null); return; }
    const source = getPlayableSource(currentTrack);
    const url = currentTrack?.sources?.[source]?.url;
    if (!source || !url) { setStreamQuality(null); return; }

    let cancelled = false;
    setStreamQuality(null); // reset while we fetch
    const bitrate = qualityToBitrate(readAppSettings().audioQuality);
    api.getStreamInfo(url, source, bitrate).then(info => {
      if (!cancelled && info && info.bitrate_kbps) {
        setStreamQuality({ bitrate: info.bitrate_kbps, codec: info.codec || null });
      }
    });
    return () => { cancelled = true; };
  }, [currentTrack]);

  const playTrack = useCallback(async (track, opts = {}) => {
    // Cancel any ongoing crossfade
    if (crossfadeTimerRef.current) {
      clearInterval(crossfadeTimerRef.current);
      crossfadeTimerRef.current = null;
    }
    crossfadingRef.current = false;
    crossfadeAudioRef.current.pause();
    crossfadeAudioRef.current.src = '';

    const audio = audioRef.current;
    const playableTrack = normalizeTrack(track);
    // A DOWNLOADED track has no streaming sources of its own when it was
    // rebuilt from disk by /api/downloads/local (mergeScannedTracks gives it
    // `sources: {}`). Rejecting on getPlayableSource alone therefore made
    // offline files unplayable — the exact opposite of the "offline-FIRST"
    // promise below. A local file is a perfectly good source.
    if (!getPlayableSource(playableTrack) && !getOfflineEntry(playableTrack)) {
      setPlaybackError("This track is not playable yet");
      setIsPlaying(false);
      setIsLoading(false);
      return;
    }

    // Push current track to history before switching
    if (currentTrack) {
      setHistory(prev => [currentTrack, ...prev.slice(0, 49)]); // keep last 50
    }
    
    // opts.autoplay === false loads the track PAUSED at opts.resumeAt (used to
    // restore the last session on reopen). Default is play-now.
    const autoplay = opts.autoplay !== false;
    pendingSeekRef.current = autoplay ? 0 : (opts.resumeAt || 0);

    setCurrentTrack(playableTrack);
    setIsPlaying(autoplay);
    setIsLoading(true);
    setPlaybackError(null);
    setProgress(autoplay ? 0 : (opts.resumeAt || 0));
    setDuration(0);

    try {
      // Offline-FIRST: a downloaded track must play from disk even if its
      // streaming sources are empty/expired (and especially when there's no
      // internet). We check the local file BEFORE any stream-url guard.
      const offline = getOfflineEntry(playableTrack);
      const candidates = getPlayableSources(playableTrack);

      if (!offline && candidates.length === 0) {
        setPlaybackError("This track is not playable yet");
        setIsPlaying(false);
        setIsLoading(false);
        return;
      }

      // Stop current playback
      audio.pause();
      audio.currentTime = 0;

      if (offline) {
        // Play the downloaded file. Keep the streaming sources as fallbacks
        // (idx>0) so a deleted/moved file (404) falls back to streaming instead
        // of dead-ending; the 'error' handler also drops the stale registry
        // entry when the local file is the source that failed.
        playAttemptRef.current = {
          sources: [{ source: 'local', url: offline.filePath, local: true }, ...candidates],
          idx: 0,
        };
        audio.src = api.localFileUrl(offline.filePath);
      } else {
        // Try the track's sources in quality order; the audio 'error' handler
        // falls back to the next source if one is dead/DRM/geo-blocked — so a
        // song that's also on YouTube still plays when its SoundCloud copy is
        // DRM-locked, instead of just failing.
        playAttemptRef.current = { sources: candidates, idx: 0 };
        audio.src = buildProxyUrl(candidates[0].url, candidates[0].source);
      }
      audio.volume = volumeRef.current;

      // If the Web Audio graph is active (normalization on), make sure the
      // context is running so audio actually flows through it.
      resumeAudioCtx();

      // Record recently-played at play-START, not after play() resolves: when
      // the first source fails (e.g. SoundCloud DRM) the promise rejects and the
      // track still plays via the 'error'-handler fallback (YouTube) — gating
      // the save on the first source dropped those tracks from Recently Played.
      saveRecentlyPlayed(playableTrack);

      // Restore mode (autoplay === false): load the source but stay paused; the
      // browser blocks autoplay without a gesture anyway. handleCanPlay seeks to
      // the saved timestamp. Otherwise start immediately.
      if (autoplay) {
        await audio.play();
      } else {
        audio.load();   // begin buffering so canplay fires and applies the seek
        setIsLoading(false);
      }

    } catch (err) {
      // Autoplay policy needs a user gesture and fires NO 'error' event, so the
      // catch must surface that one. Every OTHER rejection is a load failure (or
      // an AbortError because the fallback already swapped the src) that ALSO
      // fires an 'error' event — and the audio 'error' handler owns cross-source
      // fallback, auto-skip, and the final error message, which it shows only
      // AFTER every source has been tried. Surfacing it here too would flash the
      // error before the working source is even attempted.
      if (err?.name === 'NotAllowedError') {
        setPlaybackError('Click play to start — browser requires interaction first');
        setIsPlaying(false);
        setIsLoading(false);
      }
    }
  }, [currentTrack]);

  // Restore the last session ONCE on mount: same song, same timestamp, paused.
  // Uses a ref because this runs a single time while playTrack's identity changes.
  const playTrackRef = useRef(playTrack);
  useEffect(() => { playTrackRef.current = playTrack; }, [playTrack]);
  useEffect(() => {
    const s = readResumeState();
    if (s && s.track) {
      playTrackRef.current(s.track, { autoplay: false, resumeAt: s.position });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePlay = useCallback(() => {
    if (!currentTrack) return;
    const audio = audioRef.current;
    if (isPlaying) {
      audio.pause();
      // Don't set isPlaying here — the 'pause' event handler will do it
    } else {
      resumeAudioCtx();
      audio.play().catch(e => console.error(e));
      // Don't set isPlaying here — the 'playing' event handler will do it
    }
  }, [currentTrack, isPlaying, resumeAudioCtx]);

  const seek = useCallback((time) => {
    const audio = audioRef.current;
    if (isFinite(time)) {
      audio.currentTime = time;
      setProgress(time);
    }
  }, []);

  const changeVolume = useCallback((val) => {
    const audio = audioRef.current;
    audio.volume = val;
    setVolume(val);
  }, []);

  const playNext = useCallback(() => {
    // Cancel any ongoing crossfade first
    if (crossfadeTimerRef.current) {
      clearInterval(crossfadeTimerRef.current);
      crossfadeTimerRef.current = null;
    }
    crossfadingRef.current = false;
    crossfadeAudioRef.current.pause();
    crossfadeAudioRef.current.src = '';

    if (queue.length > 0) {
      const nextTrack = queue[0];
      setQueue(q => q.slice(1));
      playTrack(nextTrack);
    } else if (repeat === 'all' && history.length > 0) {
      // Loop: rebuild queue from history and start over
      const reversed = [...history].reverse();
      setQueue(reversed.slice(1));
      playTrack(reversed[0]);
      setHistory([]);
    } else if (readAppSettings().autoplay && repeat !== 'all' && !radioLoadingRef.current) {
      // Queue exhausted — pull radio similar tracks and keep playing (fallback
      // for when the prefetch effect hasn't topped the queue up in time).
      // The current song keeps playing during the async fetch.
      radioLoadingRef.current = true;
      fetchRadioTracks(currentTrackRef.current)
        .then(adds => {
          if (adds.length > 0) {
            playTrack(adds[0]);
            setQueue(adds.slice(1));
          } else {
            audioRef.current.pause(); // nothing to play next — stop cleanly (syncs isPlaying)
          }
        })
        .finally(() => { radioLoadingRef.current = false; });
    } else {
      audioRef.current.pause(); // nothing to play next — pause syncs isPlaying via event
    }
  }, [queue, shuffle, repeat, history, playTrack, fetchRadioTracks]);

  // Keep the ref always pointing to the latest playNext
  useEffect(() => { playNextRef.current = playNext; }, [playNext]);

  const playPrevious = useCallback(() => {
    // Cancel crossfade
    if (crossfadeTimerRef.current) {
      clearInterval(crossfadeTimerRef.current);
      crossfadeTimerRef.current = null;
    }
    crossfadingRef.current = false;
    crossfadeAudioRef.current.pause();
    crossfadeAudioRef.current.src = '';

    const audio = audioRef.current;
    // If we're more than 3 seconds in, restart current track
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      setProgress(0);
    } else if (history.length > 0) {
      // Go to previous track
      const prev = history[0];
      // Push current track back to front of queue
      if (currentTrack) {
        setQueue(q => [currentTrack, ...q]);
      }
      setHistory(h => h.slice(1));
      // Play previous without adding to history (since we're going back)
      setCurrentTrack(prev);
      setIsPlaying(true);
      setIsLoading(true);
      setPlaybackError(null);
      setProgress(0);
      setDuration(0);
      
      const source = getPlayableSource(prev);
      const urlToStream = prev.sources?.[source]?.url;
      if (urlToStream) {
        const proxyUrl = buildProxyUrl(urlToStream, source);
        audio.pause();
        playAttemptRef.current = null;
        audio.src = proxyUrl;
        audio.volume = volumeRef.current;
        audio.play().catch(() => {});
      } else {
        setPlaybackError("This track is not playable yet");
        setIsPlaying(false);
        setIsLoading(false);
      }
    }
  }, [history, currentTrack]);

  // Ref for playPrevious (used by MediaSession and keyboard shortcuts)
  const playPreviousRef = useRef(playPrevious);
  useEffect(() => { playPreviousRef.current = playPrevious; }, [playPrevious]);

  const addToQueue = useCallback((track) => {
    const playableTrack = normalizeTrack(track);
    if (!isPlayableOrOffline(playableTrack)) return;
    // Insert before the first autoplay/radio track so manual picks play first.
    setQueue(q => {
      const idx = q.findIndex(t => t._autoplay);
      if (idx === -1) return [...q, playableTrack];
      return [...q.slice(0, idx), playableTrack, ...q.slice(idx)];
    });
  }, []);

  const addNext = useCallback((track) => {
    const playableTrack = normalizeTrack(track);
    if (!isPlayableOrOffline(playableTrack)) return;
    setQueue(q => [playableTrack, ...q]);
  }, []);

  const removeFromQueue = useCallback((index) => {
    setQueue(q => q.filter((_, i) => i !== index));
  }, []);

  // Move a queue item from one position to another (drag-to-reorder). Also
  // updates the remembered natural order so a later un-shuffle stays consistent.
  const reorderQueue = useCallback((from, to) => {
    setQueue(q => {
      if (from === to || from < 0 || to < 0 || from >= q.length || to >= q.length) return q;
      const next = q.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      naturalOrderRef.current = null; // manual order now wins over shuffle memory
      return next;
    });
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
  }, []);

  // The queue setter exposed to views (row "play" handlers). When shuffle is on,
  // the queued remainder is shuffled (and natural order remembered) so playing
  // from any list respects shuffle — the engine itself plays the queue in order.
  const replaceQueue = useCallback((tracks) => {
    const list = queueableTracks(tracks);
    if (shuffleRef.current) {
      naturalOrderRef.current = list;
      setQueue(shuffleArray(list));
    } else {
      naturalOrderRef.current = null;
      setQueue(list);
    }
  }, []);

  // Shuffle toggles the SHARED mode (playbar + every collection bar read the
  // same `shuffle`). Turning it on reorders the UPCOMING queue (the current
  // track keeps playing); turning it off restores the remaining tracks to their
  // natural order. The queue is the play order — the engine plays it top-down.
  const toggleShuffle = useCallback(() => {
    const next = !shuffleRef.current;
    setShuffle(next);
    const q = queueRef.current;
    if (next) {
      naturalOrderRef.current = [...q];
      setQueue(shuffleArray(q));
    } else if (naturalOrderRef.current) {
      const natural = naturalOrderRef.current;
      const naturalIds = new Set(natural.map(getTrackId));
      const present = new Set(q.map(getTrackId));
      const restored = natural.filter(t => present.has(getTrackId(t)));
      const extras = q.filter(t => !naturalIds.has(getTrackId(t))); // e.g. radio added mid-shuffle
      setQueue([...restored, ...extras]);
      naturalOrderRef.current = null;
    }
  }, []);

  // Atomic "play this collection" command (album / playlist / liked). Starts at
  // a random track when shuffled (and sets the shared shuffle mode to match),
  // capturing natural order so a later un-shuffle can restore it. One command =
  // no race between setting the queue and the flag.
  const playCollection = useCallback((tracks, shuffled) => {
    const list = queueableTracks(tracks);
    if (list.length === 0) return;
    setShuffle(shuffled);
    if (shuffled) {
      const order = shuffleArray(list);
      const first = order[0];
      naturalOrderRef.current = list.filter(t => getTrackId(t) !== getTrackId(first));
      setQueue(order.slice(1));
      playTrack(first);
    } else {
      naturalOrderRef.current = null;
      setQueue(list.slice(1));
      playTrack(list[0]);
    }
  }, [playTrack]);

  const cycleRepeat = useCallback(() => {
    setRepeat(r => {
      if (r === 'off') return 'all';
      if (r === 'all') return 'one';
      return 'off';
    });
  }, []);

  // Recently played persistence
  const saveRecentlyPlayed = (track) => {
    try {
      const stored = JSON.parse(localStorage.getItem('recentlyPlayed') || '[]');
      writeStoredTracks('recentlyPlayed', [track, ...stored], 20);
    } catch (e) {
      console.error("Failed to save recently played:", e);
    }
  };

  return (
    <PlayerContext.Provider
      value={{
        currentTrack,
        isPlaying,
        isLoading,
        playbackError,
        volume,
        progress,
        duration,
        queue,
        history,
        shuffle,
        repeat,
        streamQuality,
        playTrack,
        playCollection,
        togglePlay,
        seek,
        changeVolume,
        playNext,
        playPrevious,
        setQueue: replaceQueue,
        addToQueue,
        addNext,
        removeFromQueue,
        reorderQueue,
        clearQueue,
        toggleShuffle,
        cycleRepeat,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export const usePlayer = () => useContext(PlayerContext);
