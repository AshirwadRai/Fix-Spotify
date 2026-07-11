import { useState, useEffect, useRef, useMemo } from 'react';
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, Download, ListMusic, Mic2, Disc3, Check, Plus, GripVertical, Bluetooth,
} from 'lucide-react';
import { usePlayer } from '../../store/PlayerContext';
import { useDownloads } from '../../store/DownloadsContext';
import { api } from '../../api';
import { getBestArtworkUrl, cleanText, splitArtists } from '../../utils/tracks';
import { isLiked, toggleLiked } from '../../utils/likes';
import { isDownloaded } from '../../utils/downloads';
import { useDominantColor } from '../../utils/useDominantColor';
import { usePlayFrom } from '../usePlayFrom';
import { SourceBadge } from './SourceBadge';
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
    queue, reorderQueue,
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

  const artwork = currentTrack ? getBestArtworkUrl(currentTrack) : '';
  const rgb = useDominantColor(artwork);

  const touchStartY = useRef(0);
  const activeLineRef = useRef(null);

  useEffect(() => {
    setLiked(currentTrack ? isLiked(currentTrack) : false);
  }, [currentTrack]);

  // Reset to the artwork pane on track change, so a new song never opens on the
  // previous song's lyrics.
  useEffect(() => {
    setPane('art');
    setLyrics({ plain: '', synced: [], source: null });
  }, [currentTrack?.title, currentTrack?.artist]);

  // Lyrics are fetched lazily — only when that pane is actually opened.
  useEffect(() => {
    if (pane !== 'lyrics' || !currentTrack || lyrics.source) return;
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
  };

  return (
    <div
      className={`sheet ${open ? 'sheet-open' : 'sheet-closed'} fixed inset-0 z-50 flex flex-col`}
      style={{
        background: `linear-gradient(180deg, ${bg} 0%, rgba(18,18,18,0.96) 55%, #121212 100%)`,
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
          <button
            type="button"
            aria-label="Add to playlist"
            onClick={() => onAddToPlaylist?.(currentTrack)}
            className="tap p-1 -mr-1"
          >
            <Plus size={22} />
          </button>
        </div>
      </div>

      {/* Pane — the ONLY flexible row. min-h-0 lets it shrink and scroll rather
          than pushing the controls below the fold. */}
      <div className="flex-1 min-h-0 flex flex-col">
        {pane === 'art' && (
          <div className="flex-1 min-h-0 flex items-center justify-center px-6">
            <div className="w-full aspect-square max-h-full rounded-lg overflow-hidden shadow-2xl bg-black/30">
              {artwork ? (
                <img src={artwork} alt="" className="w-full h-full object-cover" />
              ) : null}
            </div>
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
              Next up · hold <GripVertical size={11} className="inline -mt-0.5" /> to reorder
            </p>
            {queue.length === 0 && (
              <p className="text-white/50 text-sm px-1 py-4">
                Nothing queued. Autoplay will keep the music going when this ends.
              </p>
            )}
            {queue.map((t, i) => (
              <div
                key={`${t.title}-${i}`}
                data-qidx={i}
                className={`flex items-center gap-2 rounded transition-colors ${
                  dragFrom === i ? 'opacity-40' : ''
                } ${dragOver === i && dragFrom !== null && dragFrom !== i ? 'bg-white/10' : ''}`}
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
                  onTouchStart={() => setDragFrom(i)}
                >
                  <GripVertical size={18} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Track info + like/download */}
      <div className="shrink-0 px-6 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-white truncate">
              {cleanText(currentTrack.title)}
            </h1>
            {/* Each credited artist is its own target — tapping "Sia" on a
                Diljit × Sia track opens Sia, not a fictional "Diljit, Sia". */}
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-sm text-white/70 truncate max-w-full">
                {splitArtists(currentTrack.artist).map((name, i, all) => (
                  <span key={name}>
                    <button
                      type="button"
                      onClick={() => onOpenArtist?.(name)}
                      className="tap text-left transition-colors duration-fast active:text-white"
                    >
                      {name}
                    </button>
                    {i < all.length - 1 && <span aria-hidden="true">, </span>}
                  </span>
                ))}
              </p>
              <SourceBadge track={currentTrack} className="shrink-0" />
            </div>
          </div>

          <div className="flex items-center gap-1 pt-0.5">
            <button
              type="button"
              aria-label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
              onClick={() => { toggleLiked(currentTrack); setLiked((v) => !v); }}
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
                <Download size={22} className="text-white/70" />
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

        {/* Pane switcher — Song / Lyrics / Queue. Sits ABOVE the transport row so
            the play controls stay in the same spot regardless of which pane is
            open. */}
        <div className="flex items-center justify-center gap-2 mt-3">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPane(id)}
              aria-pressed={pane === id}
              className={`tap flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-medium transition-colors duration-fast ${
                pane === id
                  ? 'bg-white/15 text-white'
                  : 'text-white/50 active:text-white'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {/* Where the sound is actually going. Only shown when it ISN'T the
            phone's own speaker, so it stays quiet until it's useful. */}
        {audioOutput && (
          <div className="flex items-center justify-center gap-1.5 mt-2 text-[11px] text-spotify-essential-bright-accent">
            <Bluetooth size={13} className="shrink-0" />
            <span className="truncate max-w-[70%]">{audioOutput}</span>
          </div>
        )}

        {/* Transport */}
        <div className="flex items-center justify-between mt-3">
          <button
            type="button"
            aria-label="Shuffle"
            onClick={toggleShuffle}
            className={`tap p-2 ${shuffle ? 'text-spotify-essential-bright-accent' : 'text-white/60'}`}
          >
            <Shuffle size={20} />
          </button>

          <button type="button" aria-label="Previous" onClick={playPrevious} className="tap p-2">
            <SkipBack size={28} fill="white" className="text-white" />
          </button>

          <button
            type="button"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            onClick={togglePlay}
            className="tap w-16 h-16 rounded-full bg-white flex items-center justify-center"
          >
            {isPlaying ? (
              <Pause size={26} className="text-black" fill="black" />
            ) : (
              <Play size={26} className="text-black ml-0.5" fill="black" />
            )}
          </button>

          <button type="button" aria-label="Next" onClick={playNext} className="tap p-2">
            <SkipForward size={28} fill="white" className="text-white" />
          </button>

          <button
            type="button"
            aria-label="Repeat"
            onClick={cycleRepeat}
            className={`tap p-2 ${repeat !== 'off' ? 'text-spotify-essential-bright-accent' : 'text-white/60'}`}
          >
            {repeat === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
          </button>
        </div>

        {/* pb-safe clears the Android gesture bar so the transport row isn't
            swallowed by the system back-gesture area. */}
        <div className="pb-safe" />
      </div>
    </div>
  );
}
