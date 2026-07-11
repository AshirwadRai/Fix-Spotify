import { useEffect, useMemo } from 'react';
import { X, RotateCw, AlertCircle, Loader2, Play, WifiOff } from 'lucide-react';
import { useDownloads } from '../../store/DownloadsContext';
import { usePlayer } from '../../store/PlayerContext';
import { useOfflineTracks } from '../../utils/downloads';
import { cleanText, getBestArtworkUrl } from '../../utils/tracks';
import { TrackItem } from '../components/TrackItem';
import { usePlayFrom } from '../usePlayFrom';

function mb(n) {
  if (!n) return '';
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Downloads = the in-progress queue PLUS the offline library.
 *
 * The offline half is the important part: those rows are tappable and play
 * straight from the file on disk, with no internet at all. PlayerContext checks
 * for a local file BEFORE trying any stream (getOfflineEntry → /api/local),
 * so a downloaded song plays offline automatically — nothing special to do here
 * beyond handing it the track.
 */
export function DownloadsTab({ onMenu }) {
  const { tasks, downloadDir, cancel, retry, clearCompleted, refresh } = useDownloads();
  const { currentTrack, isPlaying, playCollection } = usePlayer();
  const playFrom = usePlayFrom();

  const offlineMap = useOfflineTracks();
  // useOfflineTracks() is a MAP keyed by track id — not an array.
  const offlineTracks = useMemo(
    () => Object.values(offlineMap || {}).map((e) => e.track).filter(Boolean),
    [offlineMap]
  );

  useEffect(() => { refresh(); }, [refresh]);

  const active = tasks.filter((t) => ['queued', 'downloading', 'pending'].includes(t.status));
  const failed = tasks.filter((t) => ['failed', 'error'].includes(t.status));

  return (
    <div className="flex flex-col h-full">
      <div className="pt-safe shrink-0">
        <div className="flex items-end justify-between px-4 pt-4 pb-3">
          <h1 className="text-2xl font-bold">Downloads</h1>
          {tasks.some((t) => t.status === 'completed') && (
            <button
              type="button"
              onClick={clearCompleted}
              className="text-[13px] text-spotify-text-subdued"
            >
              Clear finished
            </button>
          )}
        </div>
      </div>

      <div className="scroll-y flex-1">
        {/* Play-all bar for the offline library */}
        {offlineTracks.length > 0 && (
          <div className="flex items-center gap-3 px-4 pb-3">
            <div className="flex items-center gap-1.5 text-[12px] text-spotify-essential-bright-accent flex-1">
              <WifiOff size={14} />
              {offlineTracks.length} songs playable offline
            </div>
            <button
              type="button"
              aria-label="Play all downloaded"
              onClick={() => playCollection(offlineTracks, false)}
              className="tap w-11 h-11 rounded-full bg-spotify-essential-bright-accent flex items-center justify-center"
            >
              <Play size={20} className="text-black ml-0.5" fill="black" />
            </button>
          </div>
        )}

        {active.length > 0 && (
          <Section title={`Downloading (${active.length})`}>
            {active.map((t) => (
              <TaskRow key={t.id} task={t} onCancel={() => cancel(t.id)} />
            ))}
          </Section>
        )}

        {failed.length > 0 && (
          <Section title="Failed">
            {failed.map((t) => (
              <TaskRow key={t.id} task={t} onRetry={() => retry(t.id)} />
            ))}
          </Section>
        )}

        {/* The offline library — tap any row to play it from disk. */}
        {offlineTracks.length > 0 && (
          <Section title={`On this device (${offlineTracks.length})`}>
            {offlineTracks.map((t, i) => (
              <TrackItem
                key={`${t.title}-${t.artist}-${i}`}
                track={t}
                index={i}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                onPlay={() => playFrom(offlineTracks, i)}
                onMenu={onMenu}
              />
            ))}
          </Section>
        )}

        {tasks.length === 0 && offlineTracks.length === 0 && (
          <p className="text-center text-spotify-text-subdued text-sm mt-20 px-10">
            No downloads yet. Tap the ⋮ menu on any song and choose Download to keep
            it on your phone — it will play even with no internet.
          </p>
        )}

        {downloadDir && (
          <p className="px-4 py-6 text-[11px] text-spotify-essential-subdued break-all">
            Saved to {downloadDir}
          </p>
        )}

        <div className="h-6" />
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mt-1">
      <h2 className="text-xs uppercase tracking-wider text-spotify-text-subdued px-4 py-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** An in-flight or failed download. Completed ones are shown as playable tracks. */
function TaskRow({ task, onCancel, onRetry }) {
  const info = task.track_info || {};
  // task.progress is ALREADY a 0-100 percentage (download_manager caps it at 99
  // until completion). Multiplying by 100 pinned the bar at 100% the instant
  // real progress passed 1% — which read as an instant 0 -> 100 jump.
  const pct = Math.min(100, Math.max(0, Math.round(task.progress || 0)));
  const downloading = ['downloading', 'queued', 'pending'].includes(task.status);
  const isFailed = ['failed', 'error'].includes(task.status);

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded overflow-hidden bg-spotify-elevated-base shrink-0 relative">
          {getBestArtworkUrl(info) ? (
            <img src={getBestArtworkUrl(info)} alt="" className="w-full h-full object-cover" />
          ) : null}
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            {downloading && <Loader2 size={18} className="text-white animate-spin" />}
            {isFailed && <AlertCircle size={18} className="text-spotify-essential-negative" />}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[14px] truncate">{cleanText(info.title) || 'Unknown track'}</p>
          <p className="text-[12px] text-spotify-text-subdued truncate">
            {cleanText(info.artist)}
            {task.total_bytes ? ` · ${mb(task.total_bytes)}` : ''}
            {isFailed && task.error ? ` · ${task.error}` : ''}
          </p>
        </div>

        {onCancel && (
          <button type="button" aria-label="Cancel" onClick={onCancel} className="p-2 text-spotify-text-subdued">
            <X size={18} />
          </button>
        )}
        {onRetry && (
          <button type="button" aria-label="Retry" onClick={onRetry} className="p-2 text-spotify-text-subdued">
            <RotateCw size={18} />
          </button>
        )}
      </div>

      {downloading && (
        <div className="h-1 bg-white/10 rounded-full mt-2 overflow-hidden">
          <div
            className="h-full bg-spotify-essential-bright-accent transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
