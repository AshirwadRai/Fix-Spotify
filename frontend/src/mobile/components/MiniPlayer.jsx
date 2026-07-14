import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Play, Pause, Heart, Bluetooth, Headphones } from 'lucide-react';
import { usePlayer } from '../../store/PlayerContext';
import { getBestArtworkUrl, cleanText } from '../../utils/tracks';
import { isLiked, toggleLiked } from '../../utils/likes';
import { useDominantColor } from '../../utils/useDominantColor';
import { useAudioOutput } from '../androidBridge';

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
 * now-playing sheet. The progress hairline is DISPLAY-ONLY — seeking lives in
 * the expanded player; a draggable 2px strip here just caused accidental jumps.
 */
export function MiniPlayer({ onExpand }) {
  const {
    currentTrack, isPlaying, togglePlay, progress, duration, playNext, playPrevious,
  } = usePlayer();
  const rgb = useDominantColor(getBestArtworkUrl(currentTrack));
  const audioOutput = useAudioOutput(!!currentTrack);
  const [liked, setLiked] = useState(false);
  // Horizontal drag offset while a swipe is in progress (px). null = not swiping.
  const [dragX, setDragX] = useState(null);
  const swipeRef = useRef(null);   // { x, y, locked: 'h' | 'v' | null }
  // Follow the SHARED liked store: re-read on track change AND whenever a like
  // is toggled anywhere (expanded player, track rows) so the hearts never
  // disagree between views.
  useEffect(() => {
    const sync = () => setLiked(currentTrack ? isLiked(currentTrack) : false);
    sync();
    window.addEventListener('likedchange', sync);
    return () => window.removeEventListener('likedchange', sync);
  }, [currentTrack]);

  if (!currentTrack) return null;

  const artwork = getBestArtworkUrl(currentTrack);
  const pct = duration > 0 ? (progress / duration) * 100 : 0;

  // ── Swipe to change song ────────────────────────────────────────────────
  // Swipe LEFT for the next song, RIGHT for the previous one — the bar follows
  // the finger and springs back if the swipe was too short to count.
  //
  // The axis is LOCKED on the first few pixels of movement: without that, a
  // vertical scroll that drifts sideways would register as a song skip. Once a
  // gesture is judged vertical we ignore it entirely and let the page scroll.
  const SWIPE_MIN = 60;    // px of travel that commits to a track change

  const onTouchStart = (e) => {
    const t = e.touches[0];
    swipeRef.current = { x: t.clientX, y: t.clientY, locked: null };
  };

  const onTouchMove = (e) => {
    const s = swipeRef.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;

    if (!s.locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;   // too early to tell
      s.locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }
    if (s.locked !== 'h') return;
    setDragX(dx);
  };

  const onTouchEnd = () => {
    const s = swipeRef.current;
    swipeRef.current = null;
    const dx = dragX;
    setDragX(null);
    if (!s || s.locked !== 'h' || dx == null) return;
    if (dx <= -SWIPE_MIN) playNext();
    else if (dx >= SWIPE_MIN) playPrevious();
  };

  const swiping = dragX != null;

  // Tint the bar from the artwork, like Spotify, instead of a flat grey. The
  // dominant colour is darkened so white text/icons stay readable on top.
  const tint = rgb ? `rgb(${rgb.split(',').map((n) => Math.round(Number(n) * 0.5)).join(',')})` : null;

  return (
    <div
      className="shrink-0 mx-2 mb-1 rounded-lg overflow-hidden shadow-lg transition-colors duration-slow ease-soft"
      style={{
        backgroundColor: tint || undefined,
        // Follow the finger, then spring back. `touch-action: pan-y` lets the
        // page still scroll vertically through the bar while we own the X axis.
        touchAction: 'pan-y',
        transform: swiping ? `translateX(${dragX}px)` : undefined,
        opacity: swiping ? Math.max(0.45, 1 - Math.abs(dragX) / 240) : undefined,
        transition: swiping ? 'none' : 'transform 200ms ease-out, opacity 200ms ease-out',
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div className={`flex items-center gap-3 px-2 py-2 ${tint ? '' : 'bg-spotify-elevated-base'}`}>
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
            {/* Device name when on Bluetooth, else the artist. */}
            {audioOutput ? (
              <p className="flex items-center gap-1 text-[10.5px] text-white/70 truncate leading-tight">
                <Bluetooth size={9} className="shrink-0" />
                <span className="truncate">{audioOutput}</span>
              </p>
            ) : (
              <p className="text-[12px] text-white/70 truncate leading-tight">
                {cleanText(currentTrack.artist)}
              </p>
            )}
          </div>
        </button>

        {/* Headphones = "audio is going to your buds" — shown only when a
            Bluetooth/wired output is actually connected. */}
        {audioOutput && (
          <Headphones size={18} className="shrink-0 text-spotify-essential-bright-accent" />
        )}

        <button
          type="button"
          aria-label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
          onClick={(e) => { e.stopPropagation(); toggleLiked(currentTrack); }}
          className="tap p-2 transition-transform duration-fast active:scale-90"
        >
          <Heart
            size={20}
            className={liked ? 'text-spotify-essential-bright-accent' : 'text-white/90'}
            fill={liked ? 'currentColor' : 'none'}
          />
        </button>
        <button
          type="button"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={togglePlay}
          className="tap p-2 pr-1 text-white"
        >
          {isPlaying ? (
            <Pause size={24} fill="white" strokeWidth={0} />
          ) : (
            <Play size={24} fill="white" strokeWidth={0} />
          )}
        </button>
      </div>

      {/* Display-only progress hairline — not a control. */}
      <div className="px-2 pb-1.5">
        <div className="relative h-[2.5px] rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-white transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
