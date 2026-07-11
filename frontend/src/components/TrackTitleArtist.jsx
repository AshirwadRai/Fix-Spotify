import { cleanText, splitArtists, jiosaavnSongUrl } from '../utils/tracks';

/**
 * TrackTitleArtist — the single, shared title+artist block for every song row
 * (search, album, artist, liked, playlist, queue, now-playing). One source of
 * truth so every row exposes the SAME interactive affordances:
 *   • title  → clickable, opens the album   (when onOpenAlbum is provided)
 *   • artist → clickable, opens the profile; multi-artist credits split into
 *              individual links (Spotify-style)
 * Everything else in a row (artwork, index, duration) stays display-only, and
 * the row body itself still handles play — these links call stopPropagation so
 * navigating doesn't also start playback.
 *
 * Props:
 *   track            the track object
 *   isCurrent        highlight the title in the accent colour
 *   onOpenArtist     (name) => void   — omit to render artist as plain text
 *   onOpenAlbum      (album, artist) => void — omit to render title as plain text
 *                    (e.g. AlbumView: already on the album)
 *   showArtist       render the artist line (default true; false on an artist's
 *                    own page where the subtitle is redundant)
 *   titleClass       font-size class for the title (rows vary 13–15px)
 *   children         extra inline nodes next to the title (e.g. a Preview badge)
 */
export function TrackTitleArtist({
  track,
  isCurrent = false,
  onOpenArtist,
  onOpenAlbum,
  showArtist = true,
  titleClass = 'text-[15px]',
  cellTabIndex,
  children,
}) {
  const title = cleanText(track.title);
  const album = cleanText(track.album);
  const artists = splitArtists(track.artist);
  const primaryArtist = artists[0] || '';
  const canAlbum = Boolean(onOpenAlbum) && album && album.toLowerCase() !== 'unknown album';
  const stop = (e) => e.stopPropagation();
  const titleColor = isCurrent ? 'text-spotify-essential-bright-accent' : 'text-white';
  // When inside a TrackRow grid, the title/artist links are grid CELLS: out of
  // the linear Tab order (tabIndex=-1), reached via Arrow Left/Right. Elsewhere
  // (NowPlaying, PlayerBar) cellTabIndex is undefined → normal tab behaviour.
  const cell = cellTabIndex !== undefined ? { tabIndex: cellTabIndex, 'data-cell': '' } : {};

  return (
    <div className="flex flex-col overflow-hidden min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        {canAlbum ? (
          <button
            type="button"
            {...cell}
            onClick={(e) => { stop(e); onOpenAlbum(album, primaryArtist, jiosaavnSongUrl(track)); }}
            className={`font-medium truncate text-left hover:underline ${titleColor} ${titleClass}`}
            title={title}
          >
            {title}
          </button>
        ) : (
          <span className={`font-medium truncate ${titleColor} ${titleClass}`}>{title}</span>
        )}
        {children}
      </div>
      {showArtist && (
        <div className="text-sm text-spotify-text-subdued truncate">
          {onOpenArtist && artists.length > 0 ? (
            artists.map((a, i) => (
              <span key={i}>
                <button
                  type="button"
                  {...cell}
                  onClick={(e) => { stop(e); onOpenArtist(a); }}
                  className="hover:underline hover:text-white"
                >
                  {a}
                </button>{i < artists.length - 1 ? ', ' : ''}
              </span>
            ))
          ) : (
            cleanText(track.artist)
          )}
        </div>
      )}
    </div>
  );
}
