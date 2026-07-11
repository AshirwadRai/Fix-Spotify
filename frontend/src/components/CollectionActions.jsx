import { useMemo } from 'react';
import { Play, Pause, Shuffle, Download, Plus, Check } from 'lucide-react';
import { usePlayer } from '../store/PlayerContext';
import { useDownloads } from '../store/DownloadsContext';
import { playableTracks, sameTrack } from '../utils/tracks';
import { useSavedCollections, toggleSaved, collectionId } from '../utils/collections';

/**
 * The shared Spotify-style control bar for any collection (Liked / playlist /
 * album / JioSaavn playlist): state-aware Play/Pause, Shuffle-play, Download-all,
 * and (when `saveDescriptor` is given) a Save-to-library toggle.
 *
 * Single source of truth for the play/pause behaviour — the three views used to
 * each call `playTrack(tracks[0])` unconditionally, so they never showed pause
 * and restarted instead of resuming. Fixed once, here.
 *
 * Props:
 *   tracks         — the collection's tracks (raw or normalized; filtered here)
 *   saveDescriptor — optional {type,name,artist,image,url/albumId/songUrl,tracks}
 *                    for albums / JioSaavn playlists. Renders the Save button and
 *                    auto-saves the collection when you Download-all it.
 *   onLibraryChange — optional bump callback
 */
export function CollectionActions({ tracks, saveDescriptor, onLibraryChange }) {
  const { playCollection, currentTrack, isPlaying, togglePlay, shuffle, toggleShuffle } = usePlayer();
  const { downloadMany } = useDownloads();
  const savedCollections = useSavedCollections();

  const playable = useMemo(() => playableTracks(tracks), [tracks]);
  const empty = playable.length === 0;

  const saved = !!saveDescriptor && savedCollections.some(c => collectionId(c) === collectionId(saveDescriptor));

  // Is the track we're (or were) playing part of THIS collection?
  const contextHasCurrent = !!currentTrack && playable.some(t => sameTrack(t, currentTrack));
  const showPause = contextHasCurrent && isPlaying;

  const onPlayPause = () => {
    if (empty) return;
    if (contextHasCurrent) { togglePlay(); return; } // pause / resume in place
    playCollection(playable, shuffle); // honors the current shuffle mode
  };

  // Shuffle is the SAME shared toggle as the playbar (one `shuffle` state, both
  // light up together, both reorder the upcoming queue). If this collection
  // isn't the one playing, turning shuffle on STARTS it shuffled; if it's
  // already playing, we just flip the mode and the engine reorders what's next —
  // the current song is never dropped.
  const onShuffle = () => {
    if (empty) return;
    if (contextHasCurrent) { toggleShuffle(); return; }
    playCollection(playable, true);
  };

  // Downloading a whole collection implies wanting it in the library, so
  // auto-save it (albums / JioSaavn playlists). Own playlists / Liked have no
  // descriptor and are already library items.
  const onDownload = () => {
    if (empty) return;
    downloadMany(playable);
    if (saveDescriptor && !saved) { toggleSaved({ ...saveDescriptor, tracks: playable }); onLibraryChange?.(); }
  };

  const onToggleSave = () => {
    if (!saveDescriptor) return;
    toggleSaved({ ...saveDescriptor, tracks: playable });
    onLibraryChange?.();
  };

  return (
    <div className="flex items-center gap-6">
      <button
        onClick={onPlayPause}
        disabled={empty}
        aria-label={showPause ? 'Pause' : 'Play'}
        className="w-14 h-14 rounded-full bg-spotify-essential-bright-accent flex items-center justify-center hover:scale-105 shadow-xl transition-transform disabled:opacity-50"
      >
        {showPause
          ? <Pause className="w-6 h-6 text-black" fill="currentColor" />
          : <Play className="w-6 h-6 text-black ml-0.5" fill="currentColor" />}
      </button>

      <button
        onClick={onShuffle}
        disabled={empty}
        aria-label="Shuffle"
        title="Shuffle"
        className={`relative transition-colors disabled:opacity-50 ${shuffle ? 'text-spotify-essential-bright-accent' : 'text-spotify-text-subdued hover:text-white'}`}
      >
        <Shuffle className="w-6 h-6" />
        {shuffle && <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-spotify-essential-bright-accent" />}
      </button>

      <button
        onClick={onDownload}
        disabled={empty}
        aria-label="Download all"
        title="Download all"
        className="text-spotify-text-subdued hover:text-white transition-colors disabled:opacity-50"
      >
        <Download className="w-6 h-6" />
      </button>

      {saveDescriptor && (
        <button
          onClick={onToggleSave}
          aria-label={saved ? 'Remove from your library' : 'Add to your library'}
          title={saved ? 'Remove from your library' : 'Add to your library'}
          className={`transition-colors ${saved ? 'text-spotify-essential-bright-accent' : 'text-spotify-text-subdued hover:text-white'}`}
        >
          {saved ? <Check className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
        </button>
      )}
    </div>
  );
}
