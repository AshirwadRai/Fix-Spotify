import { Play, Pause } from 'lucide-react';
import { usePlayer } from '../store/PlayerContext';

const Equalizer = () => (
  <div className="flex items-end gap-[2px] h-3">
    <div className="w-[3px] bg-spotify-essential-bright-accent equalizer-bar" style={{ height: '100%' }} />
    <div className="w-[3px] bg-spotify-essential-bright-accent equalizer-bar" style={{ height: '66%', animationDelay: '0.2s' }} />
    <div className="w-[3px] bg-spotify-essential-bright-accent equalizer-bar" style={{ height: '80%', animationDelay: '0.4s' }} />
  </div>
);

/**
 * TrackNumberCell — the single shared #/play/pause/equalizer cell for every song
 * row (search, album, artist, liked, playlist, queue). One source of truth so
 * every row reproduces the SAME Spotify state matrix:
 *
 *   resting (not hovered, not selected):
 *     • current + playing → animated equalizer (green)
 *     • current + paused  → green index number
 *     • otherwise         → subdued index number
 *   hovered OR selected (clicked):
 *     • current + playing → Pause control
 *     • otherwise         → Play control
 *
 * Hover is CSS group-hover, so the PARENT ROW must carry the `group` class.
 * Clicking the control toggles play/pause for the current track, otherwise it
 * plays the track via onPlay (the same handler as the row body).
 *
 * Props: index (0-based), isCurrent, isPlaying, selected, onPlay.
 */
export function TrackNumberCell({ index, isCurrent, isPlaying, selected = false, onPlay }) {
  const { togglePlay } = usePlayer();
  const playingNow = isCurrent && isPlaying;
  // Resting layer hides on hover/selection so the control can show.
  const restHidden = selected ? 'opacity-0' : 'group-hover:opacity-0';
  // Control layer: shown (and clickable) only on hover/selection; otherwise
  // pointer-events-none so a row-body click still falls through to play.
  const ctrlShown = selected
    ? 'opacity-100 pointer-events-auto'
    : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto';

  return (
    <div className="relative flex items-center justify-center w-6 h-6">
      <div className={`absolute inset-0 flex items-center justify-center text-sm transition-opacity duration-150 ${restHidden}`}>
        {playingNow
          ? <Equalizer />
          : <span className={isCurrent ? 'text-spotify-essential-bright-accent' : 'text-spotify-text-subdued'}>{index + 1}</span>}
      </div>
      <button
        type="button"
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); if (isCurrent) togglePlay(); else onPlay?.(); }}
        className={`absolute inset-0 m-auto flex items-center justify-center text-white transition-opacity duration-150 ${ctrlShown}`}
        aria-label={playingNow ? 'Pause' : 'Play'}
      >
        {playingNow
          ? <Pause className="w-4 h-4" fill="currentColor" />
          : <Play className="w-4 h-4" fill="currentColor" />}
      </button>
    </div>
  );
}
