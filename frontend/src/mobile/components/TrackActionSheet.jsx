import { useState, useEffect } from 'react';
import { Heart, Download, ListPlus, FolderPlus, User, Disc3, Check, Trash2 } from 'lucide-react';
import { usePlayer } from '../../store/PlayerContext';
import { useDownloads } from '../../store/DownloadsContext';
import { getBestArtworkUrl, cleanText } from '../../utils/tracks';
import { isLiked, toggleLiked } from '../../utils/likes';
import { isDownloaded, deleteDownload } from '../../utils/downloads';
import { api } from '../../api';
import { toast } from '../../utils/toast';

/**
 * The bottom sheet that replaces the desktop right-click ContextMenu.
 *
 * A phone has no right-click and no hover, so every per-track action lives
 * behind the row's ⋮ button and surfaces here as a thumb-sized list.
 */
export function TrackActionSheet({ track, onClose, onOpenArtist, onOpenAlbum, onAddToPlaylist }) {
  const { addToQueue } = usePlayer();
  const { startDownload } = useDownloads();
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    setLiked(track ? isLiked(track) : false);
  }, [track]);

  if (!track) return null;

  const artwork = getBestArtworkUrl(track);
  const downloaded = isDownloaded(track);

  const act = (fn) => () => { fn(); onClose(); };

  const items = [
    {
      icon: liked ? Check : Heart,
      label: liked ? 'Remove from Liked Songs' : 'Add to Liked Songs',
      onClick: () => { toggleLiked(track); setLiked((v) => !v); },
      close: false,
    },
    downloaded
      ? {
          // Once downloaded, the row becomes a real action: delete the file from
          // disk AND clear it from the offline library.
          icon: Trash2,
          label: 'Remove download',
          onClick: async () => {
            const ok = await deleteDownload(track, api);
            toast(ok ? 'Removed from downloads' : 'Removed (file was already gone)');
          },
        }
      : {
          icon: Download,
          label: 'Download',
          onClick: () => startDownload(track),
        },
    { icon: ListPlus, label: 'Add to queue', onClick: () => addToQueue(track) },
    { icon: FolderPlus, label: 'Add to playlist', onClick: () => onAddToPlaylist(track) },
    { icon: User, label: 'Go to artist', onClick: () => onOpenArtist(track.artist) },
    ...(track.album
      ? [{
          icon: Disc3,
          label: 'Go to album',
          onClick: () => onOpenAlbum({ name: track.album, artist: track.artist, type: 'album' }),
        }]
      : []),
  ];

  return (
    <>
      {/* Scrim. Tapping outside the sheet closes it — standard on Android. */}
      <div
        className="sheet-scrim fixed inset-0 z-[60] bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="sheet-panel fixed inset-x-0 bottom-0 z-[61] bg-spotify-elevated-base rounded-t-2xl pb-safe">
        {/* Drag handle — purely a visual affordance that this dismisses downward. */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-9 h-1 rounded-full bg-white/25" />
        </div>

        <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10">
          <div className="w-11 h-11 rounded overflow-hidden bg-black/40 shrink-0">
            {artwork ? <img src={artwork} alt="" className="w-full h-full object-cover" /> : null}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-white truncate">{cleanText(track.title)}</p>
            <p className="text-xs text-spotify-text-subdued truncate">{cleanText(track.artist)}</p>
          </div>
        </div>

        <div className="py-2">
          {items.map(({ icon: Icon, label, onClick, close = true }) => (
            <button
              key={label}
              type="button"
              onClick={close ? act(onClick) : onClick}
              className="w-full flex items-center gap-4 px-5 py-3.5 text-left active:bg-white/5"
            >
              <Icon size={20} className="text-spotify-text-subdued shrink-0" />
              <span className="text-[15px] text-white">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
