import { Play, Pause, SkipForward } from 'lucide-react';
import { usePlayer } from '../../store/PlayerContext';
import { getBestArtworkUrl, cleanText } from '../../utils/tracks';

/**
 * The persistent bar above the tab bar. Tapping it opens the full-screen
 * now-playing sheet; the play/pause and next buttons work without leaving the
 * current tab.
 */
export function MiniPlayer({ onExpand }) {
  const { currentTrack, isPlaying, togglePlay, playNext, progress, duration } = usePlayer();

  if (!currentTrack) return null;

  const artwork = getBestArtworkUrl(currentTrack);
  const pct = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <div className="shrink-0 mx-2 mb-1 rounded-lg bg-spotify-elevated-base overflow-hidden shadow-lg">
      <div className="flex items-center gap-3 px-2 py-2">
        <button
          type="button"
          onClick={onExpand}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <div className="w-10 h-10 shrink-0 rounded overflow-hidden bg-black/40">
            {artwork ? (
              <img src={artwork} alt="" className="w-full h-full object-cover" />
            ) : null}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-white truncate leading-tight">
              {cleanText(currentTrack.title)}
            </p>
            <p className="text-[12px] text-spotify-text-subdued truncate leading-tight">
              {cleanText(currentTrack.artist)}
            </p>
          </div>
        </button>

        <button
          type="button"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={togglePlay}
          className="tap p-2 text-white"
        >
          {isPlaying ? <Pause size={22} fill="white" /> : <Play size={22} fill="white" />}
        </button>
        <button
          type="button"
          aria-label="Next track"
          onClick={playNext}
          className="tap p-2 pr-1 text-white"
        >
          <SkipForward size={20} fill="white" />
        </button>
      </div>

      {/* Hairline progress bar — the only progress affordance until the sheet
          is opened, so it stays visible even while scrolling a long list. */}
      <div className="h-[2px] bg-white/10">
        <div
          className="h-full bg-white transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
