import { Heart, Music } from 'lucide-react';
import { usePlayer } from '../store/PlayerContext';
import { playableTracks, sameTrack, formatTotalDuration } from '../utils/tracks';
import { useLikedSongs, toggleLiked } from '../utils/likes';
import { useTrackMenu } from '../utils/useTrackMenu';
import { TrackRow, TrackListHeader } from './TrackRow';
import { useRowSelection } from '../utils/useRowSelection';
import { useRovingTabIndex } from '../utils/useRovingTabIndex';
import { CollectionActions } from './CollectionActions';

export function LikedSongsView({ onLikeChange, onOpenArtist, onOpenAlbum }) {
  const likedSongs = useLikedSongs();
  const { playTrack, currentTrack, isPlaying, setQueue } = usePlayer();
  const [selIdx, setSelIdx] = useRowSelection(); // selected (clicked) row, Spotify-style
  const { openMenu, menuElement } = useTrackMenu({ onLibraryChange: onLikeChange, onOpenArtist, onOpenAlbum });

  const removeLike = (track) => { toggleLiked(track); if (onLikeChange) onLikeChange(); };

  const totalTime = formatTotalDuration(likedSongs);
  const roving = useRovingTabIndex(likedSongs.length, selIdx);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header with gradient */}
      <div className="bg-gradient-to-b from-indigo-800/80 to-spotify-base px-6 pt-12 pb-6">
        <div className="flex items-end gap-6">
          <div className="w-52 h-52 bg-gradient-to-br from-indigo-600 to-blue-300 flex items-center justify-center rounded-lg shadow-2xl shrink-0">
            <Heart className="w-20 h-20 text-white" fill="white" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-white/80 mb-2">Playlist</p>
            <h1 className="text-5xl font-black text-white mb-4">Liked Songs</h1>
            <p className="text-sm text-white/70">
              {likedSongs.length} {likedSongs.length === 1 ? 'song' : 'songs'}{totalTime && <span className="text-white/50"> · {totalTime}</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="px-6 py-4">
        <CollectionActions tracks={likedSongs} />
      </div>

      {/* Track List */}
      {likedSongs.length === 0 ? (
        <div className="text-center py-16 px-6">
          <Music className="w-12 h-12 text-spotify-text-subdued mx-auto mb-4" />
          <p className="text-lg font-semibold text-white mb-1">Songs you like will appear here</p>
          <p className="text-sm text-spotify-text-subdued">Save songs by tapping the heart icon</p>
        </div>
      ) : (
        <div className="px-4">
          <TrackListHeader />
          <div className="space-y-0.5" {...roving.listProps}>
            {likedSongs.map((track, idx) => (
              <TrackRow
                key={idx}
                track={track}
                index={idx}
                isCurrent={sameTrack(currentTrack, track)}
                isPlaying={isPlaying}
                selected={selIdx === idx}
                onSelect={setSelIdx}
                tabIndex={roving.tabIndex(idx)}
                onPlay={() => { playTrack(track); setQueue(playableTracks(likedSongs).slice(idx + 1)); }}
                onMenu={(e) => openMenu(e, track)}
                onOpenArtist={onOpenArtist}
                onOpenAlbum={onOpenAlbum}
                liked
                onToggleLike={removeLike}
              />
            ))}
          </div>
        </div>
      )}

      {/* Context Menu */}
      {menuElement}
    </div>
  );
}
