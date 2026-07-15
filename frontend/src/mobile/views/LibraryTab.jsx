import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Heart, Plus, Music2, ArrowDownToLine, Disc3, Pin, PinOff, Pencil, Trash2 } from 'lucide-react';
import { usePins, togglePin, isPinned, rowId, sortPinned, MAX_PINS } from '../../utils/pins';
import { useLikedSongs } from '../../utils/likes';
import { useSavedCollections } from '../../utils/collections';
import { useOfflineTracks } from '../../utils/downloads';
import { usePlaylists, createPlaylist, renamePlaylist, deletePlaylist } from '../usePlaylists';
import { PlaylistCover } from '../../components/PlaylistCover';
import { cleanText, sameTrack } from '../../utils/tracks';
import { usePlayer } from '../../store/PlayerContext';
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
  const { currentTrack } = usePlayer();

  // useOfflineTracks() returns a MAP keyed by track id, not an array. Treating
  // it as a list silently rendered nothing.
  const offlineMap = useOfflineTracks();
  const offlineTracks = useMemo(
    () => Object.values(offlineMap || {}).map((e) => e.track).filter(Boolean),
    [offlineMap]
  );

  // Pins float their row to the top of its own group (playlists stay among
  // playlists), which keeps the filter chips meaningful — a pinned album jumping
  // into the Playlists list would just be confusing.
  const pins = usePins();
  // The row whose long-press menu is open: { id, title, playlistId? }.
  const [menu, setMenu] = useState(null);
  const [renaming, setRenaming] = useState(null);   // { playlistId, title }

  const pin = useCallback((id) => {
    const res = togglePin(id);
    if (res === 'full') toast(`You can pin up to ${MAX_PINS} — unpin one first`);
    else if (res === 'pinned') toast('Pinned to the top');
    setMenu(null);
  }, []);

  const removePlaylist = useCallback((playlistId, title) => {
    // Deleting a playlist is not undoable — always ask first.
    if (!window.confirm(`Delete “${title}”? This can't be undone.`)) return;
    deletePlaylist(playlistId);
    toast('Playlist deleted');
    setMenu(null);
  }, []);

  const showPlaylists = filter === 'all' || filter === 'playlists';
  // Saved collections hold both albums and artists; split them by type.
  const albums = collections.filter((c) => c.type !== 'artist');
  const artists = collections.filter((c) => c.type === 'artist');
  const showAlbums = filter === 'all' || filter === 'albums';
  const showArtists = filter === 'all' || filter === 'artists';

  const sortedPlaylists = useMemo(
    () => sortPinned(playlists, pins, (p) => rowId('playlist', p)),
    [playlists, pins]
  );
  const sortedAlbums = useMemo(
    () => sortPinned(albums, pins, (c) => rowId('album', c)),
    [albums, pins]
  );

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
          <h1 className="text-[27px] font-black tracking-[-0.02em]">Your Library</h1>
          <button
            type="button"
            aria-label="Create playlist"
            onClick={() => setCreating((v) => !v)}
            className="tap p-1"
          >
            <Plus size={26} />
          </button>
        </div>

        {/* Centered modal, Spotify-style: autoFocus pops the keyboard open. */}
        {creating && (
          <div
            className="sheet-scrim fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-8"
            onClick={() => setCreating(false)}
            role="presentation"
          >
            <form
              onSubmit={submitNew}
              onClick={(e) => e.stopPropagation()}
              className="dialog-pop w-full max-w-sm rounded-2xl bg-spotify-elevated-base p-5"
            >
              <p className="text-center text-[17px] font-bold">Name your playlist</p>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My playlist"
                enterKeyHint="done"
                className="mt-4 w-full border-b-2 border-white/30 bg-transparent pb-2 text-center text-[18px] font-semibold text-white placeholder:text-white/30 outline-none focus:border-spotify-essential-bright-accent"
              />
              <div className="mt-5 flex justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="tap px-5 py-2.5 rounded-full text-[14px] font-semibold text-white/70"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!name.trim()}
                  className="tap px-6 py-2.5 rounded-full bg-spotify-essential-bright-accent text-black text-[14px] font-bold disabled:opacity-40"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
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

      <div className="scroll-y pb-bars flex-1">
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
          sortedPlaylists.map((p) => {
            const id = rowId('playlist', p);
            return (
              <Row
                key={p.id}
                Icon={Music2}
                cover={
                  <PlaylistCover tracks={p.tracks || []} image={p.image} size={56} />
                }
                title={p.name}
                // Green title while a song from this playlist is playing — same
                // signal a playing song row gives.
                active={!!currentTrack && (p.tracks || []).some((t) => sameTrack(t, currentTrack))}
                subtitle={`Playlist · ${(p.tracks || []).length} songs`}
                pinned={pins.includes(id)}
                onMenu={() => setMenu({ id, title: p.name, playlistId: p.id })}
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
            );
          })}

        {showAlbums &&
          sortedAlbums.map((c, i) => {
            const id = rowId('album', c);
            return (
              <Row
                key={`al-${c.name}-${i}`}
                image={c.image}
                Icon={Disc3}
                title={cleanText(c.name)}
                subtitle={`${c.type || 'Album'} · ${cleanText(c.artist) || 'Various'}`}
                pinned={pins.includes(id)}
                onMenu={() => setMenu({ id, title: cleanText(c.name) })}
                onClick={() => onOpenCollection(c)}
              />
            );
          })}

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

      {menu && (
        <RowMenu
          title={menu.title}
          pinned={isPinned(menu.id)}
          isPlaylist={!!menu.playlistId}
          onPin={() => pin(menu.id)}
          onEdit={() => {
            setRenaming({ playlistId: menu.playlistId, title: menu.title });
            setMenu(null);
          }}
          onDelete={() => removePlaylist(menu.playlistId, menu.title)}
          onClose={() => setMenu(null)}
        />
      )}

      {renaming && (
        <RenameDialog
          initial={renaming.title}
          onSave={(next) => {
            renamePlaylist(renaming.playlistId, next);
            setRenaming(null);
            toast('Playlist renamed');
          }}
          onClose={() => setRenaming(null)}
        />
      )}
    </div>
  );
}

/**
 * The long-press sheet for a library row.
 *
 * Edit and Delete only appear for playlists — an album you saved isn't yours to
 * rename, and "delete" would be a lie for something you can re-save in a tap.
 */
function RowMenu({ title, pinned, isPlaylist, onPin, onEdit, onDelete, onClose }) {
  const items = [
    {
      Icon: pinned ? PinOff : Pin,
      label: pinned ? 'Unpin' : `Pin to top (max ${MAX_PINS})`,
      onClick: onPin,
    },
    ...(isPlaylist ? [
      { Icon: Pencil, label: 'Rename playlist', onClick: onEdit },
      { Icon: Trash2, label: 'Delete playlist', onClick: onDelete, danger: true },
    ] : []),
  ];

  return (
    <>
      <div className="sheet-scrim fixed inset-0 z-[60] bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="sheet-panel fixed inset-x-0 bottom-0 z-[61] rounded-t-2xl bg-spotify-elevated-base pb-safe">
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-white/25" />
        <p className="truncate px-5 pt-3 pb-2 text-[13px] font-semibold">{title}</p>
        {items.map(({ Icon, label, onClick, danger }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            className={`tap flex w-full items-center gap-4 px-5 py-3.5 text-left active:bg-white/5 ${
              danger ? 'text-spotify-essential-negative' : ''
            }`}
          >
            <Icon size={19} className={`shrink-0 ${danger ? '' : 'text-spotify-text-subdued'}`} />
            <span className="text-[15px]">{label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/** Centred rename dialog — same shape as "Name your playlist" on create. */
function RenameDialog({ initial, onSave, onClose }) {
  const [value, setValue] = useState(initial);
  return (
    <div
      className="sheet-scrim fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-8"
      onClick={onClose}
      role="presentation"
    >
      <form
        onSubmit={(e) => { e.preventDefault(); onSave(value); }}
        onClick={(e) => e.stopPropagation()}
        className="dialog-pop w-full max-w-sm rounded-2xl bg-spotify-elevated-base p-5"
      >
        <p className="text-center text-[17px] font-bold">Rename playlist</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          enterKeyHint="done"
          className="mt-4 w-full border-b-2 border-white/30 bg-transparent pb-2 text-center text-[18px] font-semibold text-white outline-none focus:border-spotify-essential-bright-accent"
        />
        <div className="mt-5 flex justify-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="tap px-5 py-2.5 rounded-full text-[14px] font-semibold text-white/70"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!value.trim()}
            className="tap px-6 py-2.5 rounded-full bg-spotify-essential-bright-accent text-black text-[14px] font-bold disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * A library row.
 *
 * The trailing chevron is gone — every row here opens, so an affordance on all of
 * them carried no information. Pinning lives behind the ⋮ menu rather than as a
 * permanent button: a pin icon on every single row is a lot of ink for something
 * you do once and then leave alone. A pinned row says so with a small pin next to
 * its subtitle, which is the part that actually needs to be visible.
 *
 * `cover` is an escape hatch for a rendered element (the playlist mosaic);
 * `image` stays the simple URL path used by albums.
 */
function Row({
  image, cover, Icon, gradient, filled, rounded, title, subtitle,
  active = false, onClick, pinned = null, onMenu,
}) {
  // HOLD to open the row's menu — the ⋮ button is gone. A dedicated button on
  // every single row is a permanent 40px of chrome for something you touch once
  // in a while, and long-press is what a phone user already reaches for.
  //
  // The timer is cancelled by movement (>10px = you're scrolling, not holding)
  // and by lifting early, so a hold can never be mistaken for a tap or a scroll.
  const holdRef = useRef(null);
  const firedRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });

  const cancelHold = () => {
    clearTimeout(holdRef.current);
    holdRef.current = null;
  };

  const onPressStart = (e) => {
    if (!onMenu) return;
    const t = e.touches?.[0];
    startRef.current = { x: t?.clientX ?? 0, y: t?.clientY ?? 0 };
    firedRef.current = false;
    holdRef.current = setTimeout(() => {
      firedRef.current = true;
      // A short buzz is the only thing that tells you the hold registered before
      // the sheet animates in. Not every WebView has it, hence the guard.
      navigator.vibrate?.(12);
      onMenu();
    }, 450);
  };

  const onPressMove = (e) => {
    if (!holdRef.current) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dx = Math.abs(t.clientX - startRef.current.x);
    const dy = Math.abs(t.clientY - startRef.current.y);
    if (dx > 10 || dy > 10) cancelHold();   // that's a scroll, not a hold
  };

  useEffect(() => cancelHold, []);

  return (
    <div className="transition-colors duration-fast active:bg-white/5">
      <button
        type="button"
        // A hold already opened the menu — don't ALSO open the playlist on release.
        onClick={() => { if (!firedRef.current) onClick?.(); }}
        onTouchStart={onPressStart}
        onTouchMove={onPressMove}
        onTouchEnd={cancelHold}
        onTouchCancel={cancelHold}
        onContextMenu={(e) => e.preventDefault()}
        className="tap flex w-full min-w-0 items-center gap-3 py-2.5 pl-4 pr-3 text-left"
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
          <p className={`text-[14px] truncate ${active ? 'text-spotify-essential-bright-accent' : ''}`}>
            {title}
          </p>
          <p className="flex items-center gap-1 text-[11.5px] text-spotify-text-subdued">
            {pinned && (
              <Pin size={10} className="shrink-0 text-spotify-essential-bright-accent" fill="currentColor" />
            )}
            <span className="truncate">{subtitle}</span>
          </p>
        </div>
      </button>
    </div>
  );
}

function Empty({ text }) {
  return (
    <p className="text-center text-spotify-text-subdued text-sm mt-20 px-10">{text}</p>
  );
}
