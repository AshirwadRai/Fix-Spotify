import { useState, useRef, useCallback } from 'react';
import { Play, Pause, SkipForward } from 'lucide-react';
import { usePlayer } from '../../store/PlayerContext';
import { getBestArtworkUrl, cleanText } from '../../utils/tracks';

/**
 * The persistent bar above the tab bar. Tapping it opens the full-screen
 * now-playing sheet; the play/pause and next buttons work without leaving the
 * current tab, and the progress bar can be dragged to seek.
 */
export function MiniPlayer({ onExpand }) {
  const { currentTrack, isPlaying, togglePlay, playNext, progress, duration, seek } = usePlayer();

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
            <p className="text-[13px] text-white truncate leading-tight">
              {cleanText(currentTrack.title)}
            </p>
            <p className="text-[12px] text-spotify-text-subdued truncate leading-tight">
              {cleanText(currentTrack.artist)}
            </p>
          </div>
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
