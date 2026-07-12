import { useState, useMemo } from 'react';
import { Heart, Plus, Music2, ArrowDownToLine, Disc3, ChevronRight } from 'lucide-react';
import { useLikedSongs } from '../../utils/likes';
import { useSavedCollections } from '../../utils/collections';
import { useOfflineTracks } from '../../utils/downloads';
import { usePlaylists, createPlaylist } from '../usePlaylists';
import { PlaylistCover } from '../../components/PlaylistCover';
import { cleanText } from '../../utils/tracks';
import { toast } from '../../utils/toast';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
];

/**
 * Everything the user has saved. Each row opens a full list — the previous
 * version rendered Liked Songs as an un-openable button, which is why tapping
 * it appeared to do nothing.
 */
export function LibraryTab({ onOpenList, onOpenCollection }) {
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const liked = useLikedSongs();
  const collections = useSavedCollections();
  const playlists = usePlaylists();

  // useOfflineTracks() returns a MAP keyed by track id, not an array. Treating
  // it as a list silently rendered nothing.
  const offlineMap = useOfflineTracks();
  const offlineTracks = useMemo(
    () => Object.values(offlineMap || {}).map((e) => e.track).filter(Boolean),
    [offlineMap]
  );

  const showPlaylists = filter === 'all' || filter === 'playlists';
  // Saved collections hold both albums and artists; split them by type.
  const albums = collections.filter((c) => c.type !== 'artist');
  const artists = collections.filter((c) => c.type === 'artist');
  const showAlbums = filter === 'all' || filter === 'albums';
  const showArtists = filter === 'all' || filter === 'artists';

  const submitNew = (e) => {
    e.preventDefault();
    const pl = createPlaylist(name);
    if (!pl) return;
    toast(`Created “${pl.name}”`);
    setName('');
    setCreating(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="pt-safe shrink-0">
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <h1 className="text-[26px] font-extrabold tracking-tight">Your Library</h1>
          <button
            type="button"
            aria-label="Create playlist"
            onClick={() => setCreating((v) => !v)}
            className="tap p-1"
          >
            <Plus size={26} />
          </button>
        </div>

        {creating && (
          <form onSubmit={submitNew} className="px-4 pb-3 flex gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Playlist name"
              enterKeyHint="done"
              className="flex-1 min-w-0 h-11 px-4 rounded bg-white/10 text-white text-[15px] placeholder:text-white/40 outline-none"
            />
            <button
              type="submit"
              disabled={!name.trim()}
              className="shrink-0 px-5 h-11 rounded-full bg-spotify-essential-bright-accent text-black text-[14px] font-semibold disabled:opacity-40"
            >
              Create
            </button>
          </form>
        )}

        <div className="rail px-4 pb-3">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-[13px] whitespace-nowrap ${
                filter === f.id
                  ? 'bg-white text-black'
                  : 'bg-spotify-background-tinted-base text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-y flex-1">
        {/* Pinned: Liked Songs + Offline. Both are real, openable lists. */}
        {filter === 'all' && (
          <>
            <Row
              gradient="from-[#450af5] to-[#8e8ee5]"
              Icon={Heart}
              filled
              title="Liked Songs"
              subtitle={`Playlist · ${liked.length} songs`}
              onClick={() => onOpenList({ kind: 'liked', title: 'Liked Songs', tracks: liked })}
            />
            <Row
              gradient="from-[#1db954] to-[#0d5c2b]"
              Icon={ArrowDownToLine}
              title="Downloaded"
              subtitle={`Offline · ${offlineTracks.length} songs`}
              onClick={() =>
                onOpenList({ kind: 'offline', title: 'Downloaded', tracks: offlineTracks })
              }
            />
          </>
        )}

        {showPlaylists &&
          playlists.map((p) => (
            <Row
              key={p.id}
              Icon={Music2}
              cover={
                <PlaylistCover tracks={p.tracks || []} image={p.image} size={56} />
              }
              title={p.name}
              subtitle={`Playlist · ${(p.tracks || []).length} songs`}
              onClick={() =>
                onOpenList({
                  kind: 'playlist',
                  id: p.id,
                  title: p.name,
                  image: p.image,
                  tracks: p.tracks || [],
                })
              }
            />
          ))}

        {showAlbums &&
          albums.map((c, i) => (
            <Row
              key={`al-${c.name}-${i}`}
              image={c.image}
              Icon={Disc3}
              title={cleanText(c.name)}
              subtitle={`${c.type || 'Album'} · ${cleanText(c.artist) || 'Various'}`}
              onClick={() => onOpenCollection(c)}
            />
          ))}

        {showArtists &&
          artists.map((c, i) => (
            <Row
              key={`ar-${c.name}-${i}`}
              image={c.image}
              Icon={Music2}
              rounded
              title={cleanText(c.name)}
              subtitle="Artist"
              onClick={() => onOpenCollection(c)}
            />
          ))}

        {showPlaylists && playlists.length === 0 && filter === 'playlists' && (
          <Empty text="No playlists yet. Tap + to create one." />
        )}
        {showArtists && artists.length === 0 && filter === 'artists' && (
          <Empty text="Artists you like will show up here." />
        )}
        {showAlbums && albums.length === 0 && filter === 'albums' && (
          <Empty text="Albums you save will show up here." />
        )}

        <div className="h-6" />
      </div>
    </div>
  );
}

// `cover` is an escape hatch for a rendered element (the playlist mosaic);
// `image` stays the simple URL path used by albums.
function Row({ image, cover, Icon, gradient, filled, rounded, title, subtitle, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-fast active:bg-white/5"
    >
      <div
        className={`w-14 h-14 overflow-hidden shrink-0 flex items-center justify-center ${
          rounded ? 'rounded-full' : 'rounded'
        } ${gradient ? `bg-gradient-to-br ${gradient}` : 'bg-spotify-highlight'}`}
      >
        {cover || (image ? (
          <img src={image} alt="" className="w-full h-full object-cover" />
        ) : (
          <Icon
            size={22}
            className={gradient ? 'text-white' : 'text-spotify-text-subdued'}
            fill={filled ? 'white' : 'none'}
          />
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] truncate">{title}</p>
        <p className="text-[13px] text-spotify-text-subdued truncate">{subtitle}</p>
      </div>
      <ChevronRight size={18} className="text-spotify-essential-subdued shrink-0" />
    </button>
  );
}

function Empty({ text }) {
  return (
    <p className="text-center text-spotify-text-subdued text-sm mt-20 px-10">{text}</p>
  );
}
