import { useDownloads } from '../store/DownloadsContext';
import { useOfflineTracks, removeOfflineEntry } from '../utils/downloads';
import { usePlayer } from '../store/PlayerContext';
import { getBestArtworkUrl, cleanText } from '../utils/tracks';
import { api } from '../api';
import { Download, X, RotateCcw, FolderOpen, Trash2, Play, Music } from 'lucide-react';

const ACTIVE = ['pending', 'queued', 'downloading'];

function Artwork({ track, size = 40 }) {
  const url = getBestArtworkUrl(track);
  return url ? (
    <img src={url} alt="" className="rounded object-cover shrink-0" style={{ width: size, height: size }} />
  ) : (
    <div className="rounded bg-spotify-elevated-highlight flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <Music className="w-4 h-4 text-spotify-text-subdued" />
    </div>
  );
}

export function DownloadsView() {
  const { tasks, downloadDir, cancel, retry, clearCompleted } = useDownloads();
  const offline = useOfflineTracks();
  const { playTrack } = usePlayer();

  const active = tasks.filter(t => ACTIVE.includes(t.status));
  const failed = tasks.filter(t => t.status === 'failed' || t.status === 'cancelled');
  const offlineList = Object.values(offline).sort((a, b) => b.downloadedAt - a.downloadedAt);

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-32 pt-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-14 h-14 bg-gradient-to-br from-emerald-600 to-green-400 rounded-lg flex items-center justify-center shadow-lg">
          <Download className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white">Downloads</h1>
          <p className="text-sm text-spotify-text-subdued">{offlineList.length} available offline</p>
        </div>
      </div>

      {/* Location bar */}
      <div className="flex items-center justify-between gap-3 bg-spotify-base rounded-lg px-4 py-3 mb-6">
        <div className="overflow-hidden">
          <p className="text-xs text-spotify-text-subdued uppercase tracking-wide">Saved to</p>
          <p className="text-sm text-white truncate" title={downloadDir}>{downloadDir || '…'}</p>
        </div>
        <button
          onClick={() => api.openPath(downloadDir)}
          className="flex items-center gap-2 shrink-0 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors"
        >
          <FolderOpen className="w-4 h-4" /> Open folder
        </button>
      </div>

      {/* In progress */}
      {active.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-bold text-white uppercase tracking-wide mb-2">In progress</h2>
          <div className="space-y-1">
            {active.map(t => (
              <div key={t.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-white/5">
                <Artwork track={t.track_info} />
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm text-white truncate">{cleanText(t.track_info?.title) || 'Unknown'}</p>
                  <p className="text-xs text-spotify-text-subdued truncate">{cleanText(t.track_info?.artist)}</p>
                  <div className="mt-1 h-1 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-spotify-essential-bright-accent transition-all"
                         style={{ width: `${t.status === 'downloading' ? Math.max(t.progress, 4) : 2}%` }} />
                  </div>
                </div>
                <span className="text-xs text-spotify-text-subdued w-20 text-right shrink-0">
                  {t.status === 'downloading' ? `${Math.round(t.progress)}%` : t.status}
                </span>
                <button onClick={() => cancel(t.id)} title="Cancel"
                        className="text-spotify-text-subdued hover:text-white p-1 shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Failed */}
      {failed.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-bold text-white uppercase tracking-wide mb-2">Failed</h2>
          <div className="space-y-1">
            {failed.map(t => (
              <div key={t.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-white/5">
                <Artwork track={t.track_info} />
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm text-white truncate">{cleanText(t.track_info?.title) || 'Unknown'}</p>
                  <p className="text-xs text-red-400 truncate">{t.error || t.status}</p>
                </div>
                <button onClick={() => retry(t.id)} title="Retry"
                        className="text-spotify-text-subdued hover:text-white p-1 shrink-0">
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Downloaded / offline */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-white uppercase tracking-wide">Downloaded</h2>
          {tasks.some(t => t.status === 'completed') && (
            <button onClick={clearCompleted} className="text-xs text-spotify-text-subdued hover:text-white">
              Clear completed
            </button>
          )}
        </div>

        {offlineList.length === 0 ? (
          <p className="text-sm text-spotify-text-subdued py-6 text-center">
            No downloads yet. Use the ⋯ menu on any song and choose Download.
          </p>
        ) : (
          <div className="space-y-1">
            {offlineList.map(entry => (
              <div key={entry.track && (entry.track.title + entry.track.artist)}
                   className="flex items-center gap-3 p-2 rounded-md hover:bg-white/10 group cursor-pointer"
                   onClick={() => playTrack(entry.track)}>
                <div className="relative">
                  <Artwork track={entry.track} />
                  <div className="absolute inset-0 items-center justify-center hidden group-hover:flex bg-black/40 rounded">
                    <Play className="w-4 h-4 text-white" fill="white" />
                  </div>
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm text-white truncate">{cleanText(entry.track?.title)}</p>
                  <p className="text-xs text-spotify-text-subdued truncate">{cleanText(entry.track?.artist)}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeOfflineEntry(entry.track); }}
                  title="Remove from offline list"
                  className="opacity-0 group-hover:opacity-100 text-spotify-text-subdued hover:text-white p-1 shrink-0 transition-opacity">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
