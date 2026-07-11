import { useState } from 'react';
import { Plus, Music2 } from 'lucide-react';
import { usePlaylists, createPlaylist, addTrackToPlaylist } from '../usePlaylists';
import { cleanText, getBestArtworkUrl } from '../../utils/tracks';
import { toast } from '../../utils/toast';

/**
 * Bottom sheet: pick a playlist to add a track to, or create one on the spot.
 *
 * Creating from inside this flow matters — the first time a user wants a
 * playlist is almost always the moment they're trying to save a song into one.
 */
export function AddToPlaylistSheet({ track, onClose }) {
  const playlists = usePlaylists();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  if (!track) return null;

  const add = (playlist) => {
    const added = addTrackToPlaylist(playlist.id, track);
    toast(
      added
        ? `Added to ${playlist.name}`
        : `Already in ${playlist.name}`
    );
    onClose();
  };

  const submitNew = (e) => {
    e.preventDefault();
    const playlist = createPlaylist(name);
    if (!playlist) return;
    addTrackToPlaylist(playlist.id, track);
    toast(`Created “${playlist.name}”`);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60" onClick={onClose} aria-hidden="true" />

      <div className="fixed inset-x-0 bottom-0 z-[61] bg-spotify-elevated-base rounded-t-2xl pb-safe max-h-[75vh] flex flex-col">
        <div className="flex justify-center pt-2 pb-1 shrink-0">
          <div className="w-9 h-1 rounded-full bg-white/25" />
        </div>

        <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10 shrink-0">
          <div className="w-11 h-11 rounded overflow-hidden bg-black/40 shrink-0">
            {getBestArtworkUrl(track) ? (
              <img src={getBestArtworkUrl(track)} alt="" className="w-full h-full object-cover" />
            ) : null}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-white truncate">Add to playlist</p>
            <p className="text-xs text-spotify-text-subdued truncate">
              {cleanText(track.title)}
            </p>
          </div>
        </div>

        <div className="scroll-y flex-1 min-h-0 py-2">
          {creating ? (
            <form onSubmit={submitNew} className="px-5 py-3">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Playlist name"
                enterKeyHint="done"
                className="w-full h-12 px-4 rounded bg-white/10 text-white text-[15px] placeholder:text-white/40 outline-none focus:bg-white/15"
              />
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => { setCreating(false); setName(''); }}
                  className="flex-1 py-2.5 rounded-full bg-white/10 text-[14px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!name.trim()}
                  className="flex-1 py-2.5 rounded-full bg-spotify-essential-bright-accent text-black text-[14px] font-semibold disabled:opacity-40"
                >
                  Create
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full flex items-center gap-4 px-5 py-3.5 text-left active:bg-white/5"
            >
              <span className="w-11 h-11 rounded bg-white/10 flex items-center justify-center shrink-0">
                <Plus size={22} />
              </span>
              <span className="text-[15px] font-semibold">New playlist</span>
            </button>
          )}

          {playlists.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => add(p)}
              className="w-full flex items-center gap-4 px-5 py-3 text-left active:bg-white/5"
            >
              <span className="w-11 h-11 rounded bg-spotify-highlight flex items-center justify-center shrink-0">
                <Music2 size={20} className="text-spotify-text-subdued" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] truncate">{p.name}</span>
                <span className="block text-[12px] text-spotify-text-subdued">
                  {(p.tracks || []).length} songs
                </span>
              </span>
            </button>
          ))}

          {playlists.length === 0 && !creating && (
            <p className="px-5 py-6 text-center text-[13px] text-spotify-text-subdued">
              You don&apos;t have any playlists yet.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
