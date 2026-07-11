import { memo, useRef, useState } from 'react';
import { MoreVertical, Check, ListPlus } from 'lucide-react';
import { getBestArtworkUrl, cleanText, sameTrack } from '../../utils/tracks';
import { isDownloaded } from '../../utils/downloads';
import { usePlayer } from '../../store/PlayerContext';
import { toast } from '../../utils/toast';
import { SourceBadge } from './SourceBadge';

const SWIPE_TRIGGER = 72;   // px of right-swipe that commits "add to queue"

/**
 * One row in any track list.
 *
 * Sized for a thumb, not a mouse: the row is a 56px tap target and the overflow
 * button is padded to ~44px. Swiping the row RIGHT past a threshold adds the
 * track to the queue (like Spotify), revealing a green hint behind it on the
 * left.
 */
function TrackItemBase({
  track, index, currentTrack, isPlaying, onPlay, onMenu,
  showArtwork = true, swipeToQueue = true,
}) {
  const { addToQueue } = usePlayer();
  const active = currentTrack && sameTrack(track, currentTrack);
  const artwork = getBestArtworkUrl(track);
  const downloaded = isDownloaded(track);

  const [dx, setDx] = useState(0);          // live horizontal drag offset (≤ 0)
  const start = useRef(null);               // {x, y} or null
  const swiping = useRef(false);            // horizontal gesture locked in
  const moved = useRef(false);              // moved enough to suppress the click

  const commitSwipe = () => {
    addToQueue(track);
    toast('Added to queue');
  };

  const onTouchStart = (e) => {
    if (!swipeToQueue) return;
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    swiping.current = false;
    moved.current = false;
  };

  const onTouchMove = (e) => {
    if (!swipeToQueue || !start.current) return;
    const ddx = e.touches[0].clientX - start.current.x;
    const ddy = e.touches[0].clientY - start.current.y;
    // Lock to horizontal only once the gesture is clearly sideways, so vertical
    // list scrolling is never hijacked.
    if (!swiping.current) {
      if (Math.abs(ddx) > 10 && Math.abs(ddx) > Math.abs(ddy) * 1.5) {
        swiping.current = true;
      } else if (Math.abs(ddy) > 10) {
        start.current = null;   // it's a scroll — bail out of swipe tracking
        return;
      }
    }
    if (swiping.current) {
      moved.current = true;
      setDx(Math.min(96, Math.max(0, ddx)));   // right only, clamped
    }
  };

  const onTouchEnd = () => {
    if (swiping.current && dx >= SWIPE_TRIGGER) {
      commitSwipe();
    }
    start.current = null;
    swiping.current = false;
    setDx(0);
  };

  const handleClick = () => {
    if (moved.current) { moved.current = false; return; }   // was a swipe
    onPlay(track, index);
  };

  return (
    <div className="relative overflow-hidden">
      {/* Reveal hint behind the row while swiping right. */}
      {dx > 8 && (
        <div className="absolute inset-y-0 left-0 w-24 flex items-center justify-center gap-1 bg-spotify-essential-bright-accent text-black text-xs font-semibold">
          <ListPlus size={16} /> Queue
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: `translateX(${dx}px)`,
          transition: dx === 0 ? 'transform 180ms ease' : 'none',
        }}
        className="tap flex items-center gap-3 px-4 py-2 bg-spotify-base active:bg-white/5"
      >
        {showArtwork && (
          <div className="relative w-12 h-12 shrink-0 rounded overflow-hidden bg-spotify-elevated-base">
            {artwork ? (
              <img src={artwork} alt="" loading="lazy" className="w-full h-full object-cover" />
            ) : null}

            {active && isPlaying && (
              <div className="absolute inset-0 bg-black/50 flex items-end justify-center gap-[2px] pb-2">
                <span className="eq-bar" style={{ animationDelay: '0ms' }} />
                <span className="eq-bar" style={{ animationDelay: '150ms' }} />
                <span className="eq-bar" style={{ animationDelay: '300ms' }} />
              </div>
            )}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p
            className={`text-[15px] leading-tight truncate ${
              active ? 'text-spotify-essential-bright-accent' : 'text-white'
            }`}
          >
            {cleanText(track.title)}
          </p>
          <p className="flex items-center gap-1.5 text-[13px] leading-tight text-spotify-text-subdued mt-0.5">
            {downloaded && (
              <Check size={12} className="shrink-0 text-spotify-essential-bright-accent" />
            )}
            <span className="truncate">{cleanText(track.artist)}</span>
            <SourceBadge track={track} className="shrink-0" />
          </p>
        </div>

        <button
          type="button"
          aria-label="More options"
          onClick={(e) => {
            e.stopPropagation();
            onMenu(track);
          }}
          className="p-2.5 -mr-1.5 text-spotify-text-subdued active:text-white"
        >
          <MoreVertical size={20} />
        </button>
      </div>
    </div>
  );
}

export const TrackItem = memo(TrackItemBase);

/** Horizontal card used by the Home rails and search result grids. */
export function CardItem({ image, title, subtitle, round = false, onClick, width = 'w-36' }) {
  return (
    <button type="button" onClick={onClick} className={`tap ${width} text-left`}>
      <div
        className={`w-full aspect-square bg-spotify-elevated-base overflow-hidden mb-2 ${
          round ? 'rounded-full' : 'rounded-md'
        }`}
      >
        {image ? (
          <img src={image} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : null}
      </div>
      <p className={`text-[13px] text-white truncate ${round ? 'text-center' : ''}`}>{title}</p>
      {subtitle && (
        <p
          className={`text-[12px] text-spotify-text-subdued truncate ${round ? 'text-center' : ''}`}
        >
          {subtitle}
        </p>
      )}
    </button>
  );
}
