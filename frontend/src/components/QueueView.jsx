import { useState } from 'react';
import { Music, Trash2 } from 'lucide-react';
import { usePlayer } from '../store/PlayerContext';
import { cleanText, getBestArtworkUrl } from '../utils/tracks';
import { useLikedSongs, toggleLiked } from '../utils/likes';
import { useTrackMenu } from '../utils/useTrackMenu';
import { useRovingTabIndex } from '../utils/useRovingTabIndex';
import { TrackRow } from './TrackRow';

export function QueueView({ onLibraryChange, onOpenArtist, onOpenAlbum }) {
  const { currentTrack, isPlaying, queue, playTrack, removeFromQueue, clearQueue, setQueue } = usePlayer();
  const likedSongs = useLikedSongs();
  const { openMenu, menuElement } = useTrackMenu({ onLibraryChange, onOpenArtist, onOpenAlbum });

  const isLiked = (t) => likedSongs.some(x => cleanText(x.title) === cleanText(t.title) && cleanText(x.artist) === cleanText(t.artist));
  const toggleLike = (track) => { toggleLiked(track); if (onLibraryChange) onLibraryChange(); };

  // Shared menu + a queue-specific "Remove from queue" entry (mirrors how
  // PlaylistView adds "Remove from this playlist").
  const openQueueMenu = (e, track, idx) => openMenu(e, track, [{
    label: 'Remove from queue', icon: Trash2, destructive: true,
    onClick: () => removeFromQueue(idx),
  }]);

  // Drag state
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const roving = useRovingTabIndex(queue.length); // queue rows have no selection → tab stop starts at row 0

  const formatDuration = (ms) => {
    if (!ms) return '';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  // ─── Drag-to-reorder ────────────────────────────────────────
  const handleDragStart = (e, idx) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', idx.toString());
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
    if (dragIdx === null || dragIdx === dropIdx) return;

    const newQueue = [...queue];
    const [moved] = newQueue.splice(dragIdx, 1);
    newQueue.splice(dropIdx, 0, moved);
    setQueue(newQueue);

    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = (e) => {
    e.target.closest('.track-row')?.classList.remove('dragging');
    setDragIdx(null);
    setDragOverIdx(null);
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-4 pt-4">
      <h1 className="text-2xl font-bold text-white mb-6">Queue</h1>

      {/* Now Playing */}
      {currentTrack && (
        <section className="mb-8">
          <h3 className="text-xs font-bold text-spotify-text-subdued uppercase tracking-widest mb-3">Now Playing</h3>
          <div className="flex items-center gap-4 p-3 bg-white/5 rounded-lg">
            {getBestArtworkUrl(currentTrack) ? (
              <img src={getBestArtworkUrl(currentTrack)} className="w-12 h-12 object-cover rounded shadow" alt="" />
            ) : (
              <div className="w-12 h-12 bg-spotify-elevated-highlight rounded flex items-center justify-center shrink-0">
                <Music className="w-5 h-5 text-spotify-text-subdued" />
              </div>
            )}
            <div className="flex-1 overflow-hidden">
              <p className="text-[15px] font-medium text-spotify-essential-bright-accent truncate">{cleanText(currentTrack.title)}</p>
              <p className="text-sm text-spotify-text-subdued truncate">{cleanText(currentTrack.artist)}</p>
            </div>
            {isPlaying && (
              <div className="flex items-end gap-[2px] h-3 mr-2">
                <div className="w-[3px] bg-spotify-essential-bright-accent equalizer-bar" style={{height:'100%'}}></div>
                <div className="w-[3px] bg-spotify-essential-bright-accent equalizer-bar" style={{height:'66%',animationDelay:'0.2s'}}></div>
                <div className="w-[3px] bg-spotify-essential-bright-accent equalizer-bar" style={{height:'80%',animationDelay:'0.4s'}}></div>
              </div>
            )}
            {currentTrack.duration_ms ? (
              <span className="text-sm text-spotify-text-subdued">{formatDuration(currentTrack.duration_ms)}</span>
            ) : null}
          </div>
        </section>
      )}

      {/* Next Up */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-spotify-text-subdued uppercase tracking-widest">Next in queue</h3>
          {queue.length > 0 && (
            <button
              onClick={clearQueue}
              className="text-xs text-spotify-text-subdued hover:text-white font-semibold transition-colors"
            >
              Clear queue
            </button>
          )}
        </div>

        {queue.length === 0 ? (
          <div className="text-center py-12 text-spotify-text-subdued">
            <p className="text-sm">No tracks in queue</p>
            <p className="text-xs mt-1">Play a song to start building your queue</p>
          </div>
        ) : (
          <div className="space-y-0.5" {...roving.listProps}>
            {queue.map((track, idx) => {
              const isDragOver = dragOverIdx === idx && dragIdx !== idx;
              // Show an "Autoplay" divider before the first radio-generated track
              const showAutoplayHeader = track._autoplay && (idx === 0 || !queue[idx - 1]?._autoplay);

              return (
                <div key={idx}>
                  {showAutoplayHeader && (
                    <div className="flex items-center gap-2 pt-4 pb-2 px-1">
                      <span className="text-xs font-bold text-spotify-text-subdued uppercase tracking-widest">Autoplay</span>
                      <span className="text-[11px] text-spotify-text-subdued">Based on what you're listening to</span>
                    </div>
                  )}
                  <TrackRow
                    track={track}
                    index={idx}
                    isCurrent={false}
                    isPlaying={false}
                    tabIndex={roving.tabIndex(idx)}
                    onPlay={() => {
                      const remaining = queue.filter((_, i) => i !== idx);
                      playTrack(track);
                      setQueue(remaining);
                    }}
                    onMenu={(e) => openQueueMenu(e, track, idx)}
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
                    className={`${track._autoplay ? 'opacity-80' : ''} ${isDragOver ? 'drag-over' : ''}`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {menuElement}
    </div>
  );
}
