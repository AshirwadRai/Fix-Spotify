import { useState, useRef, useCallback, useMemo } from 'react';
import { ChevronLeft, Play, Pause, Shuffle, Heart, Music2, Trash2, Pencil, WifiOff, Camera, ArrowDownCircle, MoreVertical, SquareCheck, Square, X, ListChecks } from 'lucide-react';
import { usePlayer } from '../../store/PlayerContext';
import { useDownloads } from '../../store/DownloadsContext';
import { TrackItem } from '../components/TrackItem';
import { PlaylistCover } from '../../components/PlaylistCover';
import { usePlayFrom } from '../usePlayFrom';
import { deletePlaylist, renamePlaylist, setPlaylistImage, usePlaylists } from '../usePlaylists';
import { useLikedSongs } from '../../utils/likes';
import { useOfflineTracks, deleteDownload } from '../../utils/downloads';
import { sameTrack, getBestArtworkUrl, getTrackId } from '../../utils/tracks';
import { api } from '../../api';
import { useDominantColor } from '../../utils/useDominantColor';
import { toast } from '../../utils/toast';
import { ConfirmDialog } from '../components/ConfirmDialog';

/**
 * Full-screen list for a purely LOCAL collection — Liked Songs, a user playlist,
 * or the offline library. No network fetch: the tracks are handed in.
 *
 * (CollectionSheet is the remote counterpart — it fetches an album/artist/
 * playlist from the backend.)
 */
// A phone photo is 3-8 MB, and localStorage caps out around 5-10 MB for the
// WHOLE app. Storing one raw would evict the user's library. Downscale to a
// square thumbnail — 320px is more than a 160px cover ever needs, even at 2x.
const COVER_PX = 320;

function fileToCoverDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image'));
      img.onload = () => {
        // Center-crop to a square so the cover never appears stretched.
        const side = Math.min(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = COVER_PX;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(
          img,
          (img.width - side) / 2, (img.height - side) / 2, side, side,
          0, 0, COVER_PX, COVER_PX
        );
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function TrackListSheet({ view, onClose, onMenu }) {
  const { currentTrack, isPlaying, playCollection, shuffle, toggleShuffle, togglePlay } = usePlayer();
  const { downloadMany, tasks } = useDownloads();

  // Songs still downloading, newest first — shown only on the Downloads screen,
  // above the finished tracks. Before this, a queued download was invisible
  // until it completed and popped into the list, which read as "nothing
  // happened". `downloading` shows a live bar; `pending`/`queued` wait their turn.
  const activeDownloads = (view?.kind === 'offline' ? (tasks || []) : [])
    .filter((t) => ['pending', 'queued', 'downloading'].includes(t.status));
  const playFrom = usePlayFrom();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(view?.title || '');
  const [cover, setCover] = useState(view?.image || null);
  const [flagMenu, setFlagMenu] = useState(false);   // ⚑ → edit / delete
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── Multi-select delete (Downloads only) ────────────────────────────────
  // Hold a downloaded song to enter selection; tap others to add; a header bar
  // shows the count and deletes the lot (file + registry) after one confirm.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const holdTimer = useRef(null);

  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const enterSelect = useCallback((id) => {
    setSelectMode(true);
    setSelectedIds(new Set([id]));
  }, []);

  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  // ── Live tracks, NOT the caller's snapshot ──────────────────────────────
  // `view.tracks` is frozen at the moment the row was tapped, so anything that
  // changed the underlying list while this sheet was open — deleting a download,
  // unliking a song, removing one from the playlist — left a ghost row behind
  // until you navigated away and back. Subscribing to the stores here fixes it
  // for every local list at once; `view.tracks` stays the fallback for callers
  // that hand us an ad-hoc list with no store behind it.
  const likedLive = useLikedSongs();
  const offlineMap = useOfflineTracks();
  const playlistsLive = usePlaylists();
  const tracks = useMemo(() => {
    if (view?.kind === 'liked') return likedLive;
    if (view?.kind === 'offline') {
      return Object.values(offlineMap || {}).map((e) => e.track).filter(Boolean);
    }
    if (view?.kind === 'playlist') {
      const p = playlistsLive.find((x) => x.id === view.id);
      return p ? (p.tracks || []) : (view.tracks || []);
    }
    return view?.tracks || [];
  }, [view, likedLive, offlineMap, playlistsLive]);

  const allSelected = tracks.length > 0 && selectedIds.size === tracks.length;
  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === tracks.length ? new Set() : new Set(tracks.map((t) => getTrackId(t)))
    );
  }, [tracks]);

  const deleteSelected = useCallback(async () => {
    // Delete each selected download from disk AND the registry. `tracks` is the
    // live offline list, so removed entries drop out on the next render.
    const toDelete = tracks.filter((t) => selectedIds.has(getTrackId(t)));
    for (const t of toDelete) {
      try { await deleteDownload(t, api); } catch { /* keep going */ }
    }
    toast(`Deleted ${toDelete.length} song${toDelete.length > 1 ? 's' : ''}`);
    setConfirmBulk(false);
    exitSelect();
  }, [tracks, selectedIds, exitSelect, setConfirmBulk]);

  // Scroll-linked hero collapse — same treatment as the artist/album sheet.
  const HERO_FADE_PX = 180;
  const [fade, setFade] = useState(0);
  const ticking = useRef(false);
  const onScroll = useCallback((e) => {
    const top = e.currentTarget.scrollTop;
    if (ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      setFade(Math.min(1, Math.max(0, top / HERO_FADE_PX)));
      ticking.current = false;
    });
  }, []);

  const onPickCover = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';           // let the same file be re-picked after a reset
    if (!file || !view?.id) return;
    try {
      const dataUrl = await fileToCoverDataUrl(file);
      setPlaylistImage(view.id, dataUrl);
      setCover(dataUrl);
      toast('Cover updated');
    } catch (err) {
      toast(err.message || 'Could not use that image');
    }
  };

  // Ambient hero tint: the region around the cover takes on the cover's own
  // dominant colour (fading to the base further down), so the header area feels
  // lit by the artwork the way Spotify's playlist pages do.
  const heroArt = cover || (tracks.length ? getBestArtworkUrl(tracks[0]) : '');
  const heroRgb = useDominantColor(heroArt);

  if (!view) return null;

  // "Is THIS collection the one currently playing?" — drives the button colours,
  // so the green shuffle/play state actually reflects what you're hearing.
  const playingThis = !!currentTrack && tracks.some((t) => sameTrack(t, currentTrack));
  const isPlaylist = view.kind === 'playlist';
  const isLiked = view.kind === 'liked';
  const isOffline = view.kind === 'offline';

  const gradient = isLiked
    ? 'from-[#450af5] to-[#8e8ee5]'
    : isOffline
      ? 'from-[#1db954] to-[#0d5c2b]'
      : 'from-[#2b2b2b] to-[#121212]';

  const HeroIcon = isLiked ? Heart : isOffline ? WifiOff : Music2;
  const editing = isPlaylist && renaming;

  return (
    <div className="absolute inset-0 z-20 bg-spotify-base flex flex-col">
      {/* Selection bar — replaces the header while picking downloads to delete. */}
      {selectMode && (
        <div className="absolute inset-x-0 top-0 z-30 pt-safe bg-spotify-base/95 backdrop-blur">
          <div className="flex items-center justify-between h-14 px-3">
            <button type="button" onClick={exitSelect} aria-label="Cancel" className="tap p-2">
              <X size={24} />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold">{selectedIds.size} selected</span>
              <button
                type="button"
                onClick={toggleSelectAll}
                className="tap flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[12.5px] font-semibold"
                aria-label={allSelected ? 'Deselect all' : 'Select all'}
              >
                <ListChecks size={15} />
                {allSelected ? 'None' : 'All'}
              </button>
            </div>
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={() => setConfirmBulk(true)}
              className="tap p-2 disabled:opacity-40 text-red-400"
              aria-label="Delete selected"
            >
              <Trash2 size={22} />
            </button>
          </div>
        </div>
      )}

      {/* Sticky header — transparent over the hero, turning solid as it scrolls
          away, with a compact title taking over from the hero's. */}
      <div
        className="shrink-0 pt-safe relative z-10"
        style={{
          background: fade > 0.02 ? `rgba(18,18,18,${0.35 + fade * 0.6})` : 'transparent',
          backdropFilter: fade > 0.02 ? 'blur(12px)' : 'none',
        }}
      >
        <div className="flex items-center justify-between h-14 px-2 gap-1">
          <button type="button" onClick={onClose} aria-label="Back" className="tap p-2 shrink-0">
            <ChevronLeft size={26} />
          </button>

          <h2
            className="min-w-0 flex-1 truncate text-center text-[16px] font-bold"
            style={{ opacity: Math.max(0, (fade - 0.55) / 0.45) }}
            aria-hidden={fade < 0.55}
          >
            {view.title}
          </h2>

          {isPlaylist ? (
            // ⚑ opens a small menu with the playlist actions, instead of two
            // bare icons crowding the header.
            <button
              type="button"
              aria-label="Playlist options"
              aria-expanded={flagMenu}
              onClick={() => setFlagMenu((v) => !v)}
              className={`tap p-2 shrink-0 ${editing ? 'text-spotify-essential-bright-accent' : 'text-spotify-text-subdued'}`}
            >
              <MoreVertical size={20} />
            </button>
          ) : (
            <div className="w-10 shrink-0" />
          )}
        </div>

        {flagMenu && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setFlagMenu(false)}
            />
            <div className="absolute right-3 top-full z-20 -mt-1 w-52 overflow-hidden rounded-xl bg-spotify-elevated-base shadow-2xl dropdown-reveal">
              <button
                type="button"
                onClick={() => { setFlagMenu(false); setName(view.title); setRenaming((v) => !v); }}
                className="tap flex w-full items-center gap-3 px-4 py-3 text-left text-[14px] active:bg-white/10"
              >
                <Pencil size={17} className="text-spotify-text-subdued" />
                {editing ? 'Done editing' : 'Edit playlist'}
              </button>
              <button
                type="button"
                onClick={() => { setFlagMenu(false); setConfirmDelete(true); }}
                className="tap flex w-full items-center gap-3 px-4 py-3 text-left text-[14px] text-spotify-essential-negative active:bg-white/10"
              >
                <Trash2 size={17} /> Delete playlist
              </button>
            </div>
          </>
        )}
      </div>

      {/* Everything below scrolls together; the hero collapses as it does. */}
      <div className="scroll-y pb-bars flex-1 -mt-14" onScroll={onScroll}>
        <div
          className="pt-14"
          style={{
            background: heroRgb
              ? `linear-gradient(180deg, rgba(${heroRgb},0.55) 0%, rgba(${heroRgb},0.18) 60%, transparent 100%)`
              : 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent)',
          }}
        >
          <div
            className="px-4 pb-4 pt-4 flex flex-col items-center will-change-transform"
            style={{
              opacity: 1 - fade,
              transform: `translateY(${fade * -28}px) scale(${1 - fade * 0.2})`,
            }}
          >
            {isPlaylist ? (
              editing ? (
                // The cover is only editable in edit mode: tap to replace, and a
                // reset link appears when a custom one is set.
                <>
                  <label className="tap relative w-44 h-44 shrink-0 cursor-pointer rounded-md shadow-2xl overflow-hidden">
                    <PlaylistCover tracks={tracks} image={cover} size={176} />
                    <input type="file" accept="image/*" className="sr-only" onChange={onPickCover} />
                    <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-black/60 py-1.5 text-[11px] font-medium text-white">
                      <Camera size={13} />
                      {cover ? 'Change cover' : 'Add cover'}
                    </span>
                  </label>
                  {cover && (
                    <button
                      type="button"
                      onClick={() => { setPlaylistImage(view.id, null); setCover(null); toast('Cover reset'); }}
                      className="tap mt-2 text-[12px] text-spotify-text-subdued underline"
                    >
                      Reset to song artwork
                    </button>
                  )}
                </>
              ) : (
                <div className="w-44 h-44 shrink-0 rounded-md shadow-2xl overflow-hidden">
                  <PlaylistCover tracks={tracks} image={cover} size={176} />
                </div>
              )
            ) : (
              <div className={`w-44 h-44 rounded-md shadow-2xl bg-gradient-to-br ${gradient} flex items-center justify-center`}>
                <HeroIcon size={54} className="text-white" fill={isLiked ? 'white' : 'none'} />
              </div>
            )}

            {editing ? (
              <form
                className="w-full mt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  renamePlaylist(view.id, name);
                  setRenaming(false);
                  onClose();   // the parent re-reads playlists on close
                }}
              >
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  enterKeyHint="done"
                  className="w-full h-11 px-3 rounded bg-white/10 text-center text-lg font-bold outline-none"
                />
              </form>
            ) : (
              <h1 className="text-2xl font-bold text-center mt-4 line-clamp-2">{view.title}</h1>
            )}

            <p className="text-[13px] text-spotify-text-subdued mt-1">
              {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
              {isOffline ? ' · available offline' : ''}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4 px-4 pb-3 bg-spotify-base">
          {/* Download the whole list — same affordance albums have. Covers every
              playlist, including one imported from a Spotify link. */}
          <button
            type="button"
            aria-label="Download all"
            onClick={() => downloadMany(tracks)}
            disabled={tracks.length === 0}
            className="tap p-1 text-white/70 transition-colors duration-fast disabled:opacity-40"
          >
            <ArrowDownCircle size={22} />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            aria-label="Shuffle play"
            // Already listening to THIS collection → shuffle must not interrupt
            // the song: toggle the mode, which reshuffles (or restores) only the
            // UPCOMING queue while the current track keeps playing. Starting
            // fresh playback is only for when this collection isn't playing.
            onClick={() => (playingThis ? toggleShuffle() : playCollection(tracks, true))}
            disabled={tracks.length === 0}
            className={`tap p-1 transition-colors duration-fast disabled:opacity-40 ${
              playingThis && shuffle ? 'text-spotify-essential-bright-accent' : 'text-white/70'
            }`}
          >
            <Shuffle size={22} />
          </button>
          <button
            type="button"
            aria-label={playingThis && isPlaying ? 'Pause' : 'Play'}
            onClick={() => (playingThis ? togglePlay() : playCollection(tracks, false))}
            disabled={tracks.length === 0}
            className="tap w-14 h-14 rounded-full bg-spotify-essential-bright-accent flex items-center justify-center disabled:opacity-40 transition-transform duration-fast active:scale-95"
          >
            {playingThis && isPlaying ? (
              <Pause size={26} className="text-black" fill="black" />
            ) : (
              <Play size={26} className="text-black ml-1" fill="black" />
            )}
          </button>
        </div>

        {/* Active downloads — dimmed rows with a live progress bar, above the
            finished tracks. The whole row sits at reduced opacity ("blurred")
            so it reads as not-yet-ready; the queued ones show a thin
            indeterminate hint instead of a fill. */}
        {activeDownloads.map((t) => {
          const info = t.track_info || {};
          const pct = Math.max(0, Math.min(100, Math.round(t.progress || 0)));
          const isDownloading = t.status === 'downloading';
          return (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2 opacity-60">
              <div className="h-11 w-11 shrink-0 rounded bg-white/10 overflow-hidden">
                {getBestArtworkUrl(info) ? (
                  <img src={getBestArtworkUrl(info)} alt="" className="h-full w-full object-cover blur-[1px]" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px]">{info.title || 'Downloading…'}</p>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/15">
                  <div
                    className={`h-full rounded-full bg-spotify-essential-bright-accent ${isDownloading ? '' : 'animate-pulse w-1/3'}`}
                    style={isDownloading ? { width: `${pct}%` } : undefined}
                  />
                </div>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-spotify-text-subdued">
                {isDownloading ? `${pct}%` : 'Queued'}
              </span>
            </div>
          );
        })}

        {/* Tracks */}
        {tracks.map((t, i) => {
          // On the Downloads screen a track is selectable: hold to start a
          // selection, then tap to add/remove. A custom row (checkbox +
          // artwork + title) replaces TrackItem while selecting.
          if (isOffline) {
            const id = getTrackId(t);
            const checked = selectedIds.has(id);
            const rowHold = () => {
              holdTimer.current = setTimeout(() => enterSelect(id), 450);
            };
            const rowRelease = () => clearTimeout(holdTimer.current);
            if (selectMode) {
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleSelect(id)}
                  className="tap flex w-full items-center gap-3 px-4 py-2 text-left"
                >
                  {checked
                    ? <SquareCheck size={22} className="shrink-0 text-spotify-essential-bright-accent" />
                    : <Square size={22} className="shrink-0 text-spotify-text-subdued" />}
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded bg-white/10">
                    {getBestArtworkUrl(t) ? <img src={getBestArtworkUrl(t)} alt="" className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px]">{t.title}</p>
                    <p className="truncate text-[12px] text-spotify-text-subdued">{t.artist}</p>
                  </div>
                </button>
              );
            }
            return (
              <div key={id} onTouchStart={rowHold} onTouchEnd={rowRelease} onTouchMove={rowRelease}>
                <TrackItem
                  track={t}
                  index={i}
                  currentTrack={currentTrack}
                  isPlaying={isPlaying}
                  onPlay={() => playFrom(tracks, i)}
                  onMenu={(tk) => onMenu(tk, null)}
                />
              </div>
            );
          }
          return (
          <TrackItem
            key={`${t.title}-${t.artist}-${i}`}
            track={t}
            index={i}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            onPlay={() => playFrom(tracks, i)}
            // Hand the sheet the playlist this row came FROM, so it can offer
            // "Remove from this playlist". A track object alone can't say where
            // it's being shown.
            onMenu={(t) => onMenu(t, isPlaylist ? { playlistId: view.id, playlistName: view.title } : null)}
          />
          );
        })}

        {tracks.length === 0 && (
          <p className="text-center text-spotify-text-subdued text-sm mt-16 px-10">
            {isLiked
              ? 'Songs you like will show up here.'
              : isOffline
                ? 'Downloaded songs will show up here and play without internet.'
                : 'This playlist is empty. Use the ⋮ menu on any song to add it.'}
          </p>
        )}

        <div className="h-6" />
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete “${view.title}”?`}
          message="This can't be undone."
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            deletePlaylist(view.id);
            setConfirmDelete(false);
            toast(`Deleted “${view.title}”`);
            onClose();
          }}
        />
      )}

      {confirmBulk && (
        <ConfirmDialog
          title={`Delete ${selectedIds.size} song${selectedIds.size > 1 ? 's' : ''}?`}
          message="They'll be removed from this device — both from your library and the download folder. This can't be undone."
          confirmLabel="Delete"
          onCancel={() => setConfirmBulk(false)}
          onConfirm={deleteSelected}
        />
      )}
    </div>
  );
}
