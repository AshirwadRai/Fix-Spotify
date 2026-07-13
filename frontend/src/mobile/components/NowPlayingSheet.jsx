import { useState, useEffect, useRef, useMemo } from 'react';
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat2, Repeat1,
  Heart, ArrowDownCircle, ListMusic, Mic2, Disc3, Check, Menu, Bluetooth,
  MoreVertical, ListPlus,
} from 'lucide-react';
import { usePlayer } from '../../store/PlayerContext';
import { useDownloads } from '../../store/DownloadsContext';
import { api } from '../../api';
import { getBestArtworkUrl, cleanText, splitArtists } from '../../utils/tracks';
import { isLiked, toggleLiked } from '../../utils/likes';
import { isDownloaded } from '../../utils/downloads';
import { useDominantColor } from '../../utils/useDominantColor';
import { usePlayFrom } from '../usePlayFrom';
import { SourceBadge, QualityBadge } from './SourceBadge';
import { useAudioOutput } from '../androidBridge';

function fmt(seconds) {
  if (!seconds || Number.isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const TABS = [
  { id: 'art', label: 'Song', Icon: Disc3 },
  { id: 'lyrics', label: 'Lyrics', Icon: Mic2 },
  { id: 'queue', label: 'Queue', Icon: ListMusic },
];

/**
 * The full-screen player.
 *
 * Layout contract — this is what the first version got wrong:
 *   [header]        fixed
 *   [pane]          flex-1, min-h-0, scrolls INTERNALLY
 *   [info+controls] fixed
 *   [tab switcher]  fixed, sits above the gesture bar via pb-safe
 *
 * The pane is the ONLY thing allowed to grow. Previously the lyrics and queue
 * panes sized to their content and pushed the controls off the bottom of the
 * screen — `min-h-0` is what actually lets a flex child shrink below its
 * content size and scroll instead.
 */
export function NowPlayingSheet({ open, onClose, onOpenArtist, onAddToPlaylist }) {
  const {
    currentTrack, isPlaying, togglePlay, playNext, playPrevious,
    progress, duration, seek, shuffle, toggleShuffle, repeat, cycleRepeat,
    queue, reorderQueue, streamQuality,
  } = usePlayer();
  const { startDownload } = useDownloads();
  const playFrom = usePlayFrom();

  // Drag-to-reorder state for the queue pane. dragFrom = the row being dragged;
  // dragOver = the row it's currently hovering, so we can show a drop indicator.
  const [dragFrom, setDragFrom] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const queueRef = useRef(null);

  // Bluetooth / wired output device name — polled only while this sheet is open.
  const audioOutput = useAudioOutput(open);

  const [pane, setPane] = useState('art');
  const [lyrics, setLyrics] = useState({ plain: '', synced: [], source: null });
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [liked, setLiked] = useState(false);
  const [scrubbing, setScrubbing] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);          // ⋮ overflow menu
  const [seekFlash, setSeekFlash] = useState(null);         // { side, total } — double-tap feedback
  const lastTapRef = useRef({ t: 0, x: 0 });
  const seekFlashTimer = useRef(null);
  const seekTargetRef = useRef(null);                       // cumulative chain target
  const [dragDy, setDragDy] = useState(0);                  // px the dragged queue row follows the finger
  const dragStartYRef = useRef(0);

  const artwork = currentTrack ? getBestArtworkUrl(currentTrack) : '';
  const rgb = useDominantColor(artwork);

  const touchStartY = useRef(0);
  const activeLineRef = useRef(null);

  // Liked state follows the SHARED store, not a local copy: a heart toggled on
  // the mini-player (or anywhere else) updates here instantly, and vice versa.
  // This was the "liked in the expanded window, unliked after pressing back" bug.
  useEffect(() => {
    const sync = () => setLiked(currentTrack ? isLiked(currentTrack) : false);
    sync();
    window.addEventListener('likedchange', sync);
    return () => window.removeEventListener('likedchange', sync);
  }, [currentTrack]);

  // Double-tap on the artwork: left = back 10s, right = forward 10s. Extra taps
  // WHILE the flash is showing keep stacking, YouTube-style: 10 → 20 → 30…
  // seekTargetRef carries the chain's target because `progress` (a ~4Hz state)
  // is stale during rapid taps.
  const bumpSeek = (side) => {
    const step = side === 'back' ? -10 : 10;
    const base = seekTargetRef.current ?? (scrubbing != null ? scrubbing : progress);
    const target = Math.min(duration || Infinity, Math.max(0, base + step));
    seekTargetRef.current = target;
    seek(target);
    setSeekFlash((f) => ({ side, total: (f?.side === side ? f.total : 0) + 10 }));
    clearTimeout(seekFlashTimer.current);
    seekFlashTimer.current = setTimeout(() => {
      setSeekFlash(null);
      seekTargetRef.current = null;
    }, 700);
  };

  const onArtTap = (e) => {
    const now = Date.now();
    const x = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const side = x < window.innerWidth / 2 ? 'back' : 'fwd';
    // Chain: while the ripple is up, every single tap on that side adds 10s.
    if (seekFlash?.side === side) { bumpSeek(side); return; }
    const { t, x: px } = lastTapRef.current;
    lastTapRef.current = { t: now, x };
    if (now - t > 300 || Math.abs(x - px) > 60) return;   // not a double-tap
    lastTapRef.current = { t: 0, x: 0 };                   // consume the pair
    bumpSeek(side);
  };

  // Reset to the artwork pane on track change, so a new song never opens on the
  // previous song's lyrics.
  useEffect(() => {
    setPane('art');
    setLyrics({ plain: '', synced: [], source: null });
  }, [currentTrack?.title, currentTrack?.artist]);

  // Lyrics are PREFETCHED as soon as the track's duration is known (~1s into
  // playback) instead of waiting for the pane to open — so tapping Lyrics is
  // instant. Waiting for duration matters: lrclib uses it to pick the right
  // synced version. One request per song; the backend caches.
  useEffect(() => {
    if (!currentTrack || lyrics.source || !(duration > 0)) return;
    let cancelled = false;
    setLyricsLoading(true);
    api
      .getLyrics(currentTrack.title, currentTrack.artist, currentTrack.album || '', duration)
      .then((res) => { if (!cancelled) setLyrics(res); })
      .finally(() => { if (!cancelled) setLyricsLoading(false); });
    return () => { cancelled = true; };
  }, [pane, currentTrack, duration, lyrics.source]);

  const activeLine = useMemo(() => {
    if (!lyrics.synced?.length) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.synced.length; i += 1) {
      if (lyrics.synced[i].time <= progress) idx = i;
      else break;
    }
    return idx;
  }, [lyrics.synced, progress]);

  useEffect(() => {
    if (pane === 'lyrics' && activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeLine, pane]);

  if (!currentTrack) return null;

  const shown = scrubbing != null ? scrubbing : progress;
  const bg = rgb ? `rgb(${rgb})` : '#404040';

  // Swipe down to dismiss — only from the header, so it can't fight with
  // scrolling the lyrics or queue.
  const onTouchStart = (e) => { touchStartY.current = e.touches[0].clientY; };
  const onTouchEnd = (e) => {
    if (e.changedTouches[0].clientY - touchStartY.current > 80) onClose();
  };

  // Queue drag-to-reorder: the grip sets dragFrom; as the finger moves we read
  // the row under it (elementFromPoint) to set dragOver; release commits the move.
  const onQueueTouchMove = (e) => {
    if (dragFrom === null) return;
    const t = e.touches[0];
    setDragDy(t.clientY - dragStartYRef.current);   // the row FOLLOWS the finger
    const row = document.elementFromPoint(t.clientX, t.clientY)?.closest('[data-qidx]');
    if (row) {
      const idx = Number(row.getAttribute('data-qidx'));
      if (!Number.isNaN(idx)) setDragOver(idx);
    }
  };
  const onQueueTouchEnd = () => {
    if (dragFrom !== null && dragOver !== null && dragFrom !== dragOver) {
      reorderQueue(dragFrom, dragOver);
    }
    setDragFrom(null);
    setDragOver(null);
    setDragDy(0);
  };

  return (
    <div
      className={`sheet ${open ? 'sheet-open' : 'sheet-closed'} fixed inset-0 z-50 flex flex-col`}
      style={{
        // Fully opaque stops — the earlier 0.96-alpha midpoint let the tab
        // content ghost through the player ("background activities visible").
        background: `linear-gradient(180deg, ${bg} 0%, #161616 55%, #121212 100%)`,
      }}
    >
      {/* Header — the drag handle for dismissing */}
      <div
        className="pt-safe shrink-0"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="flex items-center justify-between px-4 h-12">
          <button type="button" onClick={onClose} aria-label="Close" className="tap p-1 -ml-1">
            <ChevronDown size={26} />
          </button>
          <p className="text-[11px] uppercase tracking-widest text-white/70 truncate px-2">
            {currentTrack.album ? cleanText(currentTrack.album) : 'Now playing'}
          </p>
          {/* ⋮ overflow — share / add to playlist. */}
          <button
            type="button"
            aria-label="More options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="tap p-1 -mr-1"
          >
            <MoreVertical size={22} />
          </button>
        </div>
      </div>

      {menuOpen && (
        <>
          {/* Tap-away catcher */}
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setMenuOpen(false)}
          />
          <div
            className="absolute right-3 z-20 w-52 overflow-hidden rounded-xl bg-spotify-elevated-base shadow-2xl animate-fade-in"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 3.25rem)' }}
          >
            <button
              type="button"
              onClick={() => { setMenuOpen(false); onAddToPlaylist?.(currentTrack); }}
              className="tap flex w-full items-center gap-3 px-4 py-3 text-left text-[14px] active:bg-white/10"
            >
              <ListPlus size={17} className="text-spotify-text-subdued" /> Add to playlist
            </button>
          </div>
        </>
      )}

      {/* Pane — the ONLY flexible row. min-h-0 lets it shrink and scroll rather
          than pushing the controls below the fold. */}
      <div className="flex-1 min-h-0 flex flex-col">
        {pane === 'art' && (
          <div
            className="relative flex-1 min-h-0 flex items-center justify-center px-6"
            onTouchEnd={onArtTap}
            onClick={(e) => { if (!('ontouchstart' in window)) onArtTap(e); }}
          >
            <div className="w-full aspect-square max-h-full rounded-lg overflow-hidden shadow-2xl bg-black/30 pointer-events-none">
              {artwork ? (
                <img src={artwork} alt="" className="w-full h-full object-cover" />
              ) : null}
            </div>

            {/* Double-tap feedback, YouTube-style: a soft half-disc from the
                tapped edge; the three arrows light up ONE AFTER ANOTHER and the
                total stacks with every extra tap (−10 → −20 → −30 seconds). */}
            {seekFlash && (
              <div
                className={`pointer-events-none absolute inset-y-0 w-1/2 flex flex-col items-center justify-center gap-1.5 text-white animate-fade-in ${
                  seekFlash.side === 'back'
                    ? 'left-0 rounded-r-[100%] bg-gradient-to-r from-white/20 to-transparent'
                    : 'right-0 rounded-l-[100%] bg-gradient-to-l from-white/20 to-transparent'
                }`}
              >
                <span className="flex items-center gap-0.5 text-[18px] leading-none drop-shadow">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="peek-arrow"
                      style={{ animationDelay: `${i * 120}ms` }}
                    >
                      {seekFlash.side === 'back' ? '◀' : '▶'}
                    </span>
                  ))}
                </span>
                <span className="text-[13px] font-medium drop-shadow">
                  {seekFlash.side === 'back' ? '−' : '+'}{seekFlash.total} seconds
                </span>
              </div>
            )}
          </div>
        )}

        {pane === 'lyrics' && (
          <div className="scroll-y flex-1 min-h-0 px-6 py-4 selectable">
            {lyricsLoading && <p className="text-center text-white/60 text-sm py-8">Loading lyrics…</p>}

            {!lyricsLoading && lyrics.synced?.length > 0 && (
              <div className="space-y-4 py-4">
                {lyrics.synced.map((line, i) => (
                  <p
                    key={`${line.time}-${i}`}
                    ref={i === activeLine ? activeLineRef : null}
                    onClick={() => seek(line.time)}
                    className={`text-[22px] font-bold leading-snug transition-all duration-300 ${
                      i === activeLine ? 'text-white' : 'text-white/40'
                    }`}
                  >
                    {line.text || '♪'}
                  </p>
                ))}
              </div>
            )}

            {!lyricsLoading && !lyrics.synced?.length && lyrics.plain && (
              <p className="whitespace-pre-wrap text-[17px] leading-relaxed text-white/80 py-4">
                {lyrics.plain}
              </p>
            )}

            {!lyricsLoading && !lyrics.synced?.length && !lyrics.plain && (
              <p className="text-center text-white/50 text-sm py-10">
                No lyrics found for this track.
              </p>
            )}
          </div>
        )}

        {pane === 'queue' && (
          <div
            ref={queueRef}
            className="scroll-y flex-1 min-h-0 px-4 py-2"
            style={{ touchAction: dragFrom !== null ? 'none' : 'pan-y' }}
            onTouchMove={onQueueTouchMove}
            onTouchEnd={onQueueTouchEnd}
          >
            <p className="text-xs uppercase tracking-wider text-white/60 mb-2 px-1">
              Next up · hold <Menu size={11} className="inline -mt-0.5" /> to reorder
            </p>
            {queue.length === 0 && (
              <p className="text-white/50 text-sm px-1 py-4">
                Nothing queued. Autoplay will keep the music going when this ends.
              </p>
            )}
            {queue.map((t, i) => {
              // Everything the drag needs, computed per row:
              //  - the picked-up row follows the finger AND ignores pointer
              //    events, so elementFromPoint can see the row underneath it
              //    (with events on, it always found ITSELF → dragOver never
              //    changed → the drop "snapped back").
              //  - rows between the pickup point and the finger slide out of
              //    the way (one row-height), opening the gap where the song
              //    will land.
              const ROW_H = 60;
              let shift = 0;
              if (dragFrom !== null && dragOver !== null && i !== dragFrom) {
                if (dragFrom < dragOver && i > dragFrom && i <= dragOver) shift = -ROW_H;
                else if (dragFrom > dragOver && i >= dragOver && i < dragFrom) shift = ROW_H;
              }
              const isDragged = dragFrom === i;
              return (
              <div
                key={`${t.title}-${i}`}
                data-qidx={i}
                style={isDragged
                  ? { transform: `translateY(${dragDy}px) scale(1.02)`, zIndex: 5, position: 'relative', pointerEvents: 'none' }
                  : { transform: `translateY(${shift}px)`, transition: 'transform 180ms cubic-bezier(0.22,0.61,0.36,1)' }}
                className={`flex items-center gap-2 rounded-2xl px-1 ${
                  isDragged ? 'bg-spotify-elevated-highlight shadow-xl' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => playFrom(queue, i)}
                  className="tap flex items-center gap-3 flex-1 min-w-0 py-2 text-left"
                >
                  <div className="w-11 h-11 rounded overflow-hidden bg-black/40 shrink-0">
                    {getBestArtworkUrl(t) ? (
                      <img src={getBestArtworkUrl(t)} alt="" className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{cleanText(t.title)}</p>
                    <p className="text-xs text-white/60 truncate">{cleanText(t.artist)}</p>
                  </div>
                </button>
                <button
                  type="button"
                  aria-label="Drag to reorder"
                  className="p-2 text-white/40 shrink-0 touch-none"
                  onTouchStart={(e) => { dragStartYRef.current = e.touches[0].clientY; setDragFrom(i); }}
                >
                  <Menu size={18} />
                </button>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Track info + like/download. pb-6 lifts the whole controls stack off the
          screen's bottom edge so the toggles/transport don't sit on the gesture
          bar. */}
      {/* pb-10 lifts the whole info/controls stack clear of the gesture bar —
          "a bit more above from the bottom". */}
      <div className="shrink-0 px-6 pt-3 pb-10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-white truncate">
              {cleanText(currentTrack.title)}
            </h1>
            {/* The WHOLE credit is one target. openArtist() splits it: a single
                name opens directly; several names open the Spotify-style picker
                sheet listing each artist — tap to choose which one to visit. */}
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => onOpenArtist?.(currentTrack.artist)}
                className="tap min-w-0 truncate text-left text-sm text-white/70 transition-colors duration-fast active:text-white"
              >
                {splitArtists(currentTrack.artist).join(', ')}
              </button>
              <SourceBadge track={currentTrack} className="shrink-0" />
              {/* kbps = what the source is ACTUALLY serving this song (reported
                  live by the backend), not the quality-setting ceiling. */}
              <QualityBadge track={currentTrack} kbps={streamQuality?.bitrate} className="shrink-0" />
            </div>
          </div>

          <div className="flex items-center gap-1 pt-0.5">
            <button
              type="button"
              aria-label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
              onClick={() => toggleLiked(currentTrack)}
              className="tap p-2"
            >
              <Heart
                size={22}
                className={liked ? 'text-spotify-essential-bright-accent' : 'text-white/70'}
                fill={liked ? 'currentColor' : 'none'}
              />
            </button>
            <button
              type="button"
              aria-label="Download"
              onClick={() => startDownload(currentTrack)}
              className="tap p-2"
              disabled={isDownloaded(currentTrack)}
            >
              {isDownloaded(currentTrack) ? (
                <Check size={22} className="text-spotify-essential-bright-accent" />
              ) : (
                <ArrowDownCircle size={22} className="text-white/70" />
              )}
            </button>
          </div>
        </div>

        {/* Seek. The value is held locally while dragging and committed on
            release — seeking on every input event would fire a Range request
            against /api/proxy_stream for each pixel of movement. */}
        <div className="mt-4">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.5}
            value={shown}
            onChange={(e) => setScrubbing(Number(e.target.value))}
            onPointerUp={() => { if (scrubbing != null) { seek(scrubbing); setScrubbing(null); } }}
            onTouchEnd={() => { if (scrubbing != null) { seek(scrubbing); setScrubbing(null); } }}
            className="slider w-full"
            aria-label="Seek"
          />
          <div className="flex justify-between text-[11px] text-white/60 -mt-1">
            <span>{fmt(shown)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        {/* One row: Song / Lyrics / Queue toggles on the LEFT, the Bluetooth
            output on the RIGHT. Above the transport so the play controls never
            shift. */}
        <div className="flex items-center justify-between gap-2 mt-3">
          <div className="flex items-center gap-1.5">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setPane(id)}
                aria-pressed={pane === id}
                className={`tap flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors duration-fast ${
                  pane === id ? 'bg-white/15 text-white' : 'text-white/50 active:text-white'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>

          {/* Where the sound is going — only when it isn't the phone speaker. */}
          {audioOutput && (
            <div className="flex items-center gap-1 min-w-0 text-[11px] text-spotify-essential-bright-accent">
              <Bluetooth size={13} className="shrink-0" />
              <span className="truncate">{audioOutput}</span>
            </div>
          )}
        </div>

        {/* Transport — sized up so the primary controls read as primary. */}
        <div className="flex items-center justify-between mt-4">
          <button
            type="button"
            aria-label="Shuffle"
            onClick={toggleShuffle}
            className={`tap p-2 ${shuffle ? 'text-spotify-essential-bright-accent' : 'text-white/60'}`}
          >
            <Shuffle size={24} />
          </button>

          <button type="button" aria-label="Previous" onClick={playPrevious} className="tap p-2">
            <SkipBack size={34} fill="white" className="text-white" />
          </button>

          <button
            type="button"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            onClick={togglePlay}
            className="tap w-[72px] h-[72px] rounded-full bg-white flex items-center justify-center"
          >
            {isPlaying ? (
              <Pause size={30} className="text-black" fill="black" />
            ) : (
              <Play size={30} className="text-black ml-1" fill="black" />
            )}
          </button>

          <button type="button" aria-label="Next" onClick={playNext} className="tap p-2">
            <SkipForward size={34} fill="white" className="text-white" />
          </button>

          <button
            type="button"
            aria-label="Repeat"
            onClick={cycleRepeat}
            className={`tap p-2 ${repeat !== 'off' ? 'text-spotify-essential-bright-accent' : 'text-white/60'}`}
          >
            {/* Replay-style loop icon; second tap shows the "1". */}
            {repeat === 'one' ? <Repeat1 size={24} /> : <Repeat2 size={24} />}
          </button>
        </div>

        {/* pb-safe clears the Android gesture bar so the transport row isn't
            swallowed by the system back-gesture area. */}
        <div className="pb-safe" />
      </div>
    </div>
  );
}
