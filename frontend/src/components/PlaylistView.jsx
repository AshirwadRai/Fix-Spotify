import { useState, useEffect, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { usePlayer } from '../store/PlayerContext';
import { cleanText, playableTracks, readPlaylists, writePlaylists, sameTrack, formatTotalDuration } from '../utils/tracks';
import { useLikedSongs, toggleLiked } from '../utils/likes';
import { useTrackMenu } from '../utils/useTrackMenu';
import { useRowSelection } from '../utils/useRowSelection';
import { useRovingTabIndex } from '../utils/useRovingTabIndex';
import { TrackRow, TrackListHeader } from './TrackRow';
import { PlaylistCover } from './PlaylistCover';
import { CollectionActions } from './CollectionActions';

export function PlaylistView({ playlistId, onNavigate, onLibraryChange, onOpenArtist, onOpenAlbum }) {
  const [playlist, setPlaylist] = useState(null);
  const { playTrack, currentTrack, isPlaying, setQueue } = usePlayer();
  const likedSongs = useLikedSongs();
  const [selIdx, setSelIdx] = useRowSelection(); // selected (clicked) row, Spotify-style
  const { openMenu, menuElement } = useTrackMenu({ onLibraryChange, onOpenArtist, onOpenAlbum });

  const isLiked = (t) => likedSongs.some(x => cleanText(x.title) === cleanText(t.title) && cleanText(x.artist) === cleanText(t.artist));
  const toggleLike = (track) => { toggleLiked(track); if (onLibraryChange) onLibraryChange(); };

  // Drag state
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const roving = useRovingTabIndex((playlist?.tracks || []).length, selIdx);

  const loadPlaylist = useCallback(() => {
    const stored = readPlaylists();
    const found = stored.find(p => p.id === playlistId);
    if (found) {
      setPlaylist({ ...found, tracks: playableTracks(found.tracks || []) });
    } else {
      setPlaylist(null);
    }
  }, [playlistId]);

  useEffect(() => {
    loadPlaylist();
  }, [playlistId, loadPlaylist]);

  const removeTrack = (track) => {
    if (!playlist) return;
    const updated = { ...playlist, tracks: playlist.tracks.filter(t => !(cleanText(t.title) === cleanText(track.title) && cleanText(t.artist) === cleanText(track.artist))) };
    setPlaylist(updated);
    const allPlaylists = readPlaylists();
    const newPlaylists = allPlaylists.map(p => p.id === playlistId ? { ...p, tracks: updated.tracks } : p);
    writePlaylists(newPlaylists);
    if (onLibraryChange) onLibraryChange();
  };

  // Open the shared track menu plus a playlist-specific "Remove" item.
  const openTrackMenu = (e, track) => openMenu(e, track, [{
    label: 'Remove from this playlist', icon: Trash2, destructive: true,
    onClick: () => removeTrack(track),
  }]);

  // ─── Drag-to-reorder ────────────────────────────────────────
  const handleDragStart = (e, idx) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', idx.toString());
    // Make the row semi-transparent
    requestAnimationFrame(() => {
      e.target.closest('.track-row')?.classList.add('dragging');
    });
  };

  const handleDragOver = (e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  };

  const handleDragLeave = () => {
    setDragOverIdx(null);
  };

  const handleDrop = (e, dropIdx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === dropIdx || !playlist) return;

    const tracks = [...playlist.tracks];
    const [moved] = tracks.splice(dragIdx, 1);
    tracks.splice(dropIdx, 0, moved);

    const updated = { ...playlist, tracks };
    setPlaylist(updated);

    // Persist to localStorage
    const allPlaylists = readPlaylists();
    const newPlaylists = allPlaylists.map(p => p.id === playlistId ? { ...p, tracks } : p);
    writePlaylists(newPlaylists);

    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = (e) => {
    e.target.closest('.track-row')?.classList.remove('dragging');
    setDragIdx(null);
    setDragOverIdx(null);
  };

  if (!playlist) {
    return (
      <div className="flex-1 flex items-center justify-center text-spotify-text-subdued">
        Playlist not found
      </div>
    );
  }

  const tracks = playlist.tracks || [];

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="flex items-end gap-6 px-6 pt-6 pb-6">
        <div className="w-56 h-56 shrink-0 rounded-md overflow-hidden shadow-2xl">
          <PlaylistCover tracks={tracks} size={224} />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold text-spotify-text-subdued uppercase tracking-wider">Playlist</span>
          <h1 className="text-5xl font-extrabold text-white">{playlist.name}</h1>
          <span className="text-sm text-spotify-text-subdued mt-1">
            {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}{(() => { const d = formatTotalDuration(tracks); return d ? ` · ${d}` : ''; })()}
          </span>
        </div>
      </div>

      {/* Controls */}
      {tracks.length > 0 && (
        <div className="px-6 pb-4">
          <CollectionActions tracks={tracks} />
        </div>
      )}

      {/* Track List */}
      {tracks.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-spotify-text-subdued text-sm">This playlist is empty</p>
          <button
            onClick={() => onNavigate('search')}
            className="mt-4 px-6 py-2.5 bg-white text-black text-sm font-bold rounded-full hover:scale-105 transition-transform"
          >
            Find songs to add
          </button>
        </div>
      ) : (
        <div className="px-4">
          <TrackListHeader dragHandle />
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
                onMenu={(e) => openTrackMenu(e, track)}
                onOpenArtist={onOpenArtist}
                onOpenAlbum={onOpenAlbum}
                liked={isLiked(track)}
                onToggleLike={toggleLike}
                dragHandle
                dnd={{
                  draggable: true,
                  onDragStart: (e) => handleDragStart(e, idx),
                  onDragOver: (e) => handleDragOver(e, idx),
                  onDragLeave: handleDragLeave,
                  onDrop: (e) => handleDrop(e, idx),
                  onDragEnd: handleDragEnd,
                }}
                className={dragOverIdx === idx && dragIdx !== idx ? 'drag-over' : ''}
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
