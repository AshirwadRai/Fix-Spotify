import { Heart, MoreHorizontal, GripVertical, Music, Clock } from 'lucide-react';
import { getBestArtworkUrl } from '../utils/tracks';
import { TrackNumberCell } from './TrackNumberCell';
import { TrackTitleArtist } from './TrackTitleArtist';

const fmtDuration = (ms) => {
  if (!ms) return '';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
};

/**
 * TrackRow — THE single song line-item, used by every playable list (search,
 * album, playlist, liked, artist popular, queue, charts, …). One skeleton →
 * identical look + behaviour everywhere. Built on the shared sub-pieces:
 * TrackNumberCell (#/play/pause/equalizer), TrackTitleArtist (title→album,
 * artist→profile), useTrackMenu (right-click + ⋯), useRowSelection (selected
 * grey box). Layout is fixed-width flex so a matching header (TrackListHeader)
 * lines up column-for-column.
 *
 * Columns:  [grip?] [#cell] [artwork?] [title/artist · flex-1] [like] [time] [⋯]
 *
 * Props:
 *   track, index                          the song + its 0-based position
 *   isCurrent, isPlaying                   playback state (for #cell + green title)
 *   selected, onSelect(index)             Spotify grey selection (omit → no selection,
 *                                          e.g. queue rows that get consumed on click)
 *   onPlay()                               REQUIRED — plays the track
 *   onMenu(e)                              opens the context menu (right-click + ⋯ button)
 *   onOpenArtist, onOpenAlbum              optional navigation (omit → plain text)
 *   showArtist (true), showArtwork (true)  hide where redundant (artist's own page)
 *   artworkUrl                             override (search enrichment); else best-of track
 *   liked, onToggleLike(track)            heart state + toggle
 *   dragHandle (false), dnd                show grip + spread DnD handlers on the row
 *   tabIndex                               roving-tabindex value (0/-1) from useRovingTabIndex;
 *                                          omit → row not keyboard-focusable (inner buttons still are)
 *   className                              extra row classes (drag-over, autoplay dim, …)
 *   titleClass                             title font-size override
 */
export function TrackRow({
  track,
  index,
  isCurrent = false,
  isPlaying = false,
  selected = false,
  onSelect,
  onPlay,
  onMenu,
  onOpenArtist,
  onOpenAlbum,
  showArtist = true,
  showArtwork = true,
  artworkUrl,
  liked = false,
  onToggleLike,
  dragHandle = false,
  dnd,
  tabIndex,
  className = '',
  titleClass = 'text-[15px]',
}) {
  const art = artworkUrl !== undefined ? artworkUrl : getBestArtworkUrl(track);
  const handlePlay = () => { onSelect?.(index); onPlay?.(); };
  // a11y (gap #4 step 2): the row is a div, so make it operable by keyboard the
  // same way it is by mouse. Enter/Space → play (Space preventDefault so the
  // page doesn't scroll). Inner like/⋯ buttons keep their own handlers + remain
  // Tab-reachable. ponytail: role="button" with nested buttons isn't the strict
  // WAI-ARIA grid pattern (interactive-in-interactive); upgrade path = full
  // grid/row/gridcell roles. Pragmatic and far lower-risk than rebuilding lists.
  const aria = `${track.title || 'Unknown'}${showArtist && track.artist ? ` by ${track.artist}` : ''}`;
  const onKeyDown = (e) => {
    if (e.target !== e.currentTarget) return; // let inner buttons handle their own keys
    // stopPropagation so the global player shortcut (window keydown: Space =
    // play/pause) doesn't ALSO fire and immediately toggle what we just played.
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); handlePlay(); }
  };

  return (
    <div
      data-row-selectable
      role="button"
      aria-label={aria}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      className={`track-row group flex items-center gap-3 h-14 px-4 rounded-md transition-colors cursor-pointer ${selected ? 'bg-white/20' : 'hover:bg-white/10'} ${className}`}
      onClick={handlePlay}
      onContextMenu={onMenu}
      {...dnd}
    >
      {dragHandle && (
        <GripVertical className="w-4 h-4 text-spotify-text-subdued opacity-0 group-hover:opacity-100 cursor-grab transition-opacity shrink-0" />
      )}

      <div className="w-6 shrink-0">
        <TrackNumberCell index={index} isCurrent={isCurrent} isPlaying={isPlaying} selected={selected} onPlay={handlePlay} />
      </div>

      {showArtwork && (
        art ? (
          <img src={art} className="w-10 h-10 object-cover rounded shadow-sm shrink-0" alt="" />
        ) : (
          <div className="w-10 h-10 bg-spotify-elevated-highlight rounded flex items-center justify-center shrink-0">
            <Music className="w-4 h-4 text-spotify-text-subdued" />
          </div>
        )
      )}

      <div className="flex-1 min-w-0">
        <TrackTitleArtist
          track={track}
          isCurrent={isCurrent}
          onOpenArtist={onOpenArtist}
          onOpenAlbum={onOpenAlbum}
          showArtist={showArtist}
          titleClass={titleClass}
          cellTabIndex={tabIndex === undefined ? undefined : -1}
        />
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onToggleLike?.(track); }}
        tabIndex={tabIndex === undefined ? undefined : -1}
        data-cell=""
        className={`shrink-0 transition-opacity duration-150 ${liked ? 'text-spotify-essential-bright-accent opacity-100' : 'opacity-0 group-hover:opacity-100 text-spotify-text-subdued hover:text-white'}`}
        aria-label={liked ? 'Remove from liked' : 'Add to liked'}
      >
        <Heart className="w-4 h-4" fill={liked ? 'currentColor' : 'none'} />
      </button>

      <span className="w-10 text-right text-sm text-spotify-text-subdued tabular-nums shrink-0">
        {fmtDuration(track.duration_ms)}
      </span>

      <button
        onClick={(e) => { e.stopPropagation(); onMenu?.(e); }}
        tabIndex={tabIndex === undefined ? undefined : -1}
        data-cell=""
        className="shrink-0 text-spotify-text-subdued hover:text-white p-1"
        aria-label="More options"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
    </div>
  );
}

/**
 * TrackListHeader — the "# / Title / ⏱" header line that sits above a TrackRow
 * list (album/playlist/liked/search-songs). Same fixed widths + gaps as the row
 * so columns align. Omit on card-ish lists (artist popular, queue) that have no
 * header.
 */
export function TrackListHeader({ dragHandle = false, showArtwork = true }) {
  return (
    <div className="flex items-center gap-3 px-4 h-9 mb-1 border-b border-spotify-elevated-highlight text-spotify-text-subdued text-xs uppercase tracking-wider">
      {dragHandle && <span className="w-4 shrink-0" />}
      <span className="w-6 text-center shrink-0">#</span>
      {showArtwork && <span className="w-10 shrink-0" />}
      <span className="flex-1 min-w-0">Title</span>
      <span className="w-4 shrink-0" />
      <span className="w-10 flex justify-end shrink-0"><Clock className="w-4 h-4" /></span>
      <span className="w-6 shrink-0" />
    </div>
  );
}
