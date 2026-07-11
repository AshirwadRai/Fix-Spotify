import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { Play, Pause, SkipForward, Heart } from 'lucide-react';
import { usePlayer } from '../../store/PlayerContext';
import { getBestArtworkUrl, cleanText } from '../../utils/tracks';
import { isLiked, toggleLiked } from '../../utils/likes';

/**
 * Horizontally scrolls its text only when it's too long to fit, Spotify-style:
 * hold, drift the overflow into view, hold, snap back, repeat. A title that
 * fits just sits still — no motion for its own sake. Honours reduced-motion.
 */
function Marquee({ text, className = '' }) {
  const wrapRef = useRef(null);
  const textRef = useRef(null);
  const [shift, setShift] = useState(0);   // px the text overflows by (0 = fits)

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const inner = textRef.current;
    if (!wrap || !inner) return;
    const over = inner.scrollWidth - wrap.clientWidth;
    setShift(over > 4 ? over : 0);
  }, [text]);

  const animate = shift > 0
    && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  return (
    <div ref={wrapRef} className={`overflow-hidden ${className}`}>
      <div
        ref={textRef}
        className={`whitespace-nowrap ${animate ? 'marquee-run' : 'truncate'}`}
        style={animate ? { '--marquee-shift': `-${shift}px` } : undefined}
      >
        {text}
      </div>
    </div>
  );
}

/**
 * The persistent bar above the tab bar. Tapping it opens the full-screen
 * now-playing sheet; the play/pause and next buttons work without leaving the
 * current tab, and the progress bar can be dragged to seek.
 */
export function MiniPlayer({ onExpand }) {
  const { currentTrack, isPlaying, togglePlay, playNext, progress, duration, seek } = usePlayer();
  const [liked, setLiked] = useState(false);
  // Re-read when the track changes (isLiked reads localStorage, not reactive).
  useEffect(() => { setLiked(currentTrack ? isLiked(currentTrack) : false); }, [currentTrack]);

  // While dragging we show the FINGER's position, not the audio's — the audio
  // keeps playing the old position until release, and a bar that snapped back
  // to it on every frame would fight the thumb.
  const [scrubbing, setScrubbing] = useState(null);
  const trackRef = useRef(null);

  const posFromEvent = useCallback((clientX) => {
    const el = trackRef.current;
    if (!el || !duration) return null;
    const { left, width } = el.getBoundingClientRect();
    if (!width) return null;
    const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
    return ratio * duration;
  }, [duration]);

  const onPointerDown = useCallback((e) => {
    if (!duration) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const t = posFromEvent(e.clientX);
    if (t != null) setScrubbing(t);
  }, [duration, posFromEvent]);

  const onPointerMove = useCallback((e) => {
    if (scrubbing == null) return;
    const t = posFromEvent(e.clientX);
    if (t != null) setScrubbing(t);
  }, [scrubbing, posFromEvent]);

  // Seek ONCE on release. Seeking per move event would fire a Range request per
  // frame and stutter the stream.
  const endScrub = useCallback(() => {
    if (scrubbing == null) return;
    seek(scrubbing);
    setScrubbing(null);
  }, [scrubbing, seek]);

  if (!currentTrack) return null;

  const artwork = getBestArtworkUrl(currentTrack);
  const shown = scrubbing != null ? scrubbing : progress;
  const pct = duration > 0 ? (shown / duration) * 100 : 0;

  return (
    <div className="shrink-0 mx-2 mb-1 rounded-lg bg-spotify-elevated-base overflow-hidden shadow-lg">
      <div className="flex items-center gap-3 px-2 py-2">
        <button
          type="button"
          onClick={onExpand}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <div className="w-10 h-10 shrink-0 rounded overflow-hidden bg-black/40">
            {artwork ? (
              <img src={artwork} alt="" className="w-full h-full object-cover" />
            ) : null}
          </div>
          <div className="flex-1 min-w-0">
            <Marquee text={cleanText(currentTrack.title)} className="text-[13px] text-white leading-tight" />
            <p className="text-[12px] text-spotify-text-subdued truncate leading-tight">
              {cleanText(currentTrack.artist)}
            </p>
          </div>
        </button>

        <button
          type="button"
          aria-label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
          onClick={(e) => { e.stopPropagation(); toggleLiked(currentTrack); setLiked((v) => !v); }}
          className="tap p-2 transition-transform duration-fast active:scale-90"
        >
          <Heart
            size={20}
            className={liked ? 'text-spotify-essential-bright-accent' : 'text-white/80'}
            fill={liked ? 'currentColor' : 'none'}
          />
        </button>
        <button
          type="button"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={togglePlay}
          className="tap p-2 text-white"
        >
          {isPlaying ? <Pause size={22} fill="white" /> : <Play size={22} fill="white" />}
        </button>
        <button
          type="button"
          aria-label="Next track"
          onClick={playNext}
          className="tap p-2 pr-1 text-white"
        >
          <SkipForward size={20} fill="white" />
        </button>
      </div>

      {/* Draggable seek bar. The bar DRAWS as a hairline but the touch target is
          the padded wrapper — a 2px strip is impossible to hit with a thumb.
          touch-none stops the browser claiming the drag as a page scroll. */}
      <div
        ref={trackRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration) || 0}
        aria-valuenow={Math.round(shown) || 0}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        className="touch-none cursor-pointer px-2 pb-2 pt-3 -mt-2"
      >
        <div className={`relative rounded-full bg-white/15 transition-[height] duration-fast ease-soft ${scrubbing != null ? 'h-[4px]' : 'h-[2px]'}`}>
          <div
            className={`h-full rounded-full bg-white ${scrubbing != null ? '' : 'transition-[width] duration-200'}`}
            style={{ width: `${pct}%` }}
          />
          {/* The thumb only exists while dragging — an always-on dot would be
              visual noise on a bar this thin. */}
          {scrubbing != null && (
            <span
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
              style={{ left: `${pct}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
