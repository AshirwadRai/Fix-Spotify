import { memo } from 'react';
import { MoreVertical, Check } from 'lucide-react';
import { getBestArtworkUrl, cleanText, sameTrack } from '../../utils/tracks';
import { isDownloaded } from '../../utils/downloads';

/**
 * One row in any track list.
 *
 * Sized for a thumb, not a mouse: the row itself is a 56px-tall tap target and
 * the overflow button is padded out to 44px, which is the minimum Android
 * recommends for a reliable touch.
 */
function TrackItemBase({ track, index, currentTrack, isPlaying, onPlay, onMenu, showArtwork = true }) {
  const active = currentTrack && sameTrack(track, currentTrack);
  const artwork = getBestArtworkUrl(track);
  const downloaded = isDownloaded(track);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPlay(track, index)}
      className="tap flex items-center gap-3 px-4 py-2 active:bg-white/5"
    >
      {showArtwork && (
        <div className="relative w-12 h-12 shrink-0 rounded overflow-hidden bg-spotify-elevated-base">
          {artwork ? (
            <img src={artwork} alt="" loading="lazy" className="w-full h-full object-cover" />
          ) : null}

          {/* Equalizer overlay marks the row that is actually sounding right
              now — clearer at a glance than a colour change alone. */}
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
        <p className="text-[13px] leading-tight text-spotify-text-subdued truncate mt-0.5">
          {downloaded && (
            <Check size={12} className="inline mr-1 text-spotify-essential-bright-accent" />
          )}
          {cleanText(track.artist)}
        </p>
      </div>

      <button
        type="button"
        aria-label="More options"
        onClick={(e) => {
          e.stopPropagation();   // don't start playback when opening the menu
          onMenu(track);
        }}
        className="p-2.5 -mr-1.5 text-spotify-text-subdued active:text-white"
      >
        <MoreVertical size={20} />
      </button>
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
