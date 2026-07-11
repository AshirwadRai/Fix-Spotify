import { useState, useEffect } from 'react';
import { Disc3 } from 'lucide-react';
import { usePlayer } from '../store/PlayerContext';
import { cleanText, getBestArtworkUrl, normalizeTracks, splitArtists, sameTrack, formatTotalDuration } from '../utils/tracks';
import { useLikedSongs, toggleLiked } from '../utils/likes';
import { refreshSavedTracks } from '../utils/collections';
import { useTrackMenu } from '../utils/useTrackMenu';
import { useRowSelection } from '../utils/useRowSelection';
import { useRovingTabIndex } from '../utils/useRovingTabIndex';
import { useDominantColor } from '../utils/useDominantColor';
import { TrackRow, TrackListHeader } from './TrackRow';
import { AlbumSkeleton } from './Skeleton';
import { CollectionActions } from './CollectionActions';
import { api } from '../api';

export function AlbumView({ name, artist, songUrl, albumId, playlistUrl, onOpenArtist, onLibraryChange }) {
  const [album, setAlbum] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selIdx, setSelIdx] = useRowSelection(); // selected (clicked) row, Spotify-style
  const { playTrack, currentTrack, isPlaying, setQueue } = usePlayer();
  const likedSongs = useLikedSongs();
  const { openMenu, menuElement } = useTrackMenu({ onLibraryChange, onOpenArtist });
  const isPlaylist = !!playlistUrl;
  const label = isPlaylist ? 'Playlist' : 'Album';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAlbum(null);
    const fetcher = isPlaylist ? api.getPlaylist(playlistUrl) : api.getAlbum(name, artist, songUrl, albumId);
    fetcher.then(data => {
      if (cancelled) return;
      if (data) {
        const norm = normalizeTracks(data.tracks || []);
        setAlbum({ ...data, tracks: norm });
        // If this collection is in the user's library, refresh its stored
        // tracklist snapshot to the live one (keeps library search in sync).
        const desc = isPlaylist
          ? { type: 'jsplaylist', name: data.name, url: playlistUrl }
          : { type: 'album', name: data.name, artist: data.artist, songUrl: songUrl || '', albumId: albumId || data.album_id || '' };
        refreshSavedTracks(desc, norm);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [name, artist, songUrl, albumId, playlistUrl, isPlaylist]);

  const isLiked = (t) => likedSongs.some(x => cleanText(x.title) === cleanText(t.title) && cleanText(x.artist) === cleanText(t.artist));
  const toggleLike = (track) => { toggleLiked(track); onLibraryChange?.(); };

  // Tint the header from the album cover (hook runs before any early return).
  const headerColor = useDominantColor(album ? (album.image || getBestArtworkUrl((album.tracks || [])[0])) : null);
  const roving = useRovingTabIndex((album?.tracks || []).length, selIdx);

  if (loading) return <AlbumSkeleton />;

  const tracks = album?.tracks || [];
  if (!album || tracks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-spotify-text-subdued gap-2 text-center px-8">
        <Disc3 className="w-12 h-12" />
        <p className="text-lg font-bold text-white">{label} not available</p>
        <p className="text-sm">We couldn't load a playable tracklist for "{cleanText(name)}".</p>
      </div>
    );
  }

  const cover = album.image || getBestArtworkUrl(tracks[0]);

  // Descriptor for saving this album/playlist to the user's library + search.
  const saveDescriptor = isPlaylist
    ? { type: 'jsplaylist', name: album.name, subtitle: album.subtitle || '', image: cover, url: playlistUrl, tracks }
    : { type: 'album', name: album.name, artist: album.artist || artist || '', image: cover, songUrl: songUrl || '', albumId: albumId || album.album_id || '', tracks };

  return (
    <div className="flex-1 overflow-y-auto">
      <div style={{ background: headerColor ? `linear-gradient(rgba(${headerColor}, 0.65) 0%, var(--color-spotify-base) 100%)` : undefined }}>
        <div className="flex items-end gap-6 px-6 pt-6 pb-6">
        <div className="w-56 h-56 shrink-0 rounded-md overflow-hidden shadow-2xl bg-spotify-elevated-highlight">
          {cover ? <img src={cover} className="w-full h-full object-cover" alt="" />
            : <div className="w-full h-full flex items-center justify-center"><Disc3 className="w-16 h-16 text-spotify-text-subdued" /></div>}
        </div>
        <div className="flex flex-col gap-2 min-w-0">
          <span className="text-xs font-bold text-spotify-text-subdued uppercase tracking-wider">{label}</span>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white leading-tight break-words line-clamp-2">{cleanText(album.name)}</h1>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm mt-1">
            {isPlaylist ? (
              album.subtitle && <span className="text-spotify-text-subdued">{cleanText(album.subtitle)}</span>
            ) : splitArtists(album.artist).map((a, i, arr) => (
              <span key={i} className="text-white">
                <button
                  onClick={() => onOpenArtist && onOpenArtist(a)}
                  className="font-semibold hover:underline"
                >
                  {a}
                </button>{i < arr.length - 1 ? ',' : ''}
              </span>
            ))}
            {album.year && <span className="text-spotify-text-subdued">· {album.year}</span>}
            <span className="text-spotify-text-subdued">· {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}</span>
            {(() => { const d = formatTotalDuration(tracks); return d ? <span className="text-spotify-text-subdued">· {d}</span> : null; })()}
          </div>
        </div>
      </div>

      <div className="px-6 pb-4">
        <CollectionActions tracks={tracks} saveDescriptor={saveDescriptor} onLibraryChange={onLibraryChange} />
      </div>
      </div>

      <div className="px-4">
        <TrackListHeader />
        <div className="space-y-0.5" {...roving.listProps}>
          {tracks.map((track, idx) => (
            <TrackRow
              key={idx}
              track={track}
              index={idx}
              isCurrent={sameTrack(currentTrack, track)}
              isPlaying={isPlaying}
              selected={selIdx === idx}
              onSelect={setSelIdx}
              tabIndex={roving.tabIndex(idx)}
              onPlay={() => { playTrack(track); setQueue(tracks.slice(idx + 1)); }}
              onMenu={(e) => openMenu(e, track)}
              onOpenArtist={onOpenArtist}
              artworkUrl={isPlaylist ? undefined : cover}
              liked={isLiked(track)}
              onToggleLike={toggleLike}
            />
          ))}
        </div>
      </div>

      {menuElement}
    </div>
  );
}
