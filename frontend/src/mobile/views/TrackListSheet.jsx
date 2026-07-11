import { useState } from 'react';
import { ChevronLeft, Play, Shuffle, Heart, Music2, Trash2, Pencil, WifiOff, Camera } from 'lucide-react';
import { usePlayer } from '../../store/PlayerContext';
import { TrackItem } from '../components/TrackItem';
import { PlaylistCover } from '../../components/PlaylistCover';
import { usePlayFrom } from '../usePlayFrom';
import { deletePlaylist, renamePlaylist, setPlaylistImage } from '../usePlaylists';
import { toast } from '../../utils/toast';

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
  const { currentTrack, isPlaying, playCollection } = usePlayer();
  const playFrom = usePlayFrom();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(view?.title || '');
  const [cover, setCover] = useState(view?.image || null);

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

  if (!view) return null;

  const tracks = view.tracks || [];
  const isPlaylist = view.kind === 'playlist';
  const isLiked = view.kind === 'liked';
  const isOffline = view.kind === 'offline';

  const gradient = isLiked
    ? 'from-[#450af5] to-[#8e8ee5]'
    : isOffline
      ? 'from-[#1db954] to-[#0d5c2b]'
      : 'from-[#2b2b2b] to-[#121212]';

  const HeroIcon = isLiked ? Heart : isOffline ? WifiOff : Music2;

  return (
    <div className="absolute inset-0 z-20 bg-spotify-base flex flex-col">
      {/* Hero */}
      <div className="shrink-0 pt-safe bg-gradient-to-b from-white/5 to-transparent">
        <div className="flex items-center justify-between h-14 px-2">
          <button type="button" onClick={onClose} aria-label="Back" className="tap p-2">
            <ChevronLeft size={26} />
          </button>

          {isPlaylist && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Rename playlist"
                onClick={() => { setName(view.title); setRenaming(true); }}
                className="tap p-2 text-spotify-text-subdued"
              >
                <Pencil size={19} />
              </button>
              <button
                type="button"
                aria-label="Delete playlist"
                onClick={() => {
                  deletePlaylist(view.id);
                  toast(`Deleted “${view.title}”`);
                  onClose();
                }}
                className="tap p-2 text-spotify-text-subdued"
              >
                <Trash2 size={19} />
              </button>
            </div>
          )}
        </div>

        <div className="px-4 pb-4 flex flex-col items-center">
          {isPlaylist ? (
            // Tap the cover to replace it. Liked/offline keep their fixed
            // gradient identity — those aren't the user's to rebrand.
            <label className="tap relative w-40 h-40 shrink-0 cursor-pointer rounded-md shadow-2xl overflow-hidden">
              <PlaylistCover tracks={tracks} image={cover} size={160} />
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={onPickCover}
              />
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-black/60 py-1.5 text-[11px] font-medium text-white">
                <Camera size={13} />
                {cover ? 'Change cover' : 'Add cover'}
              </span>
            </label>
          ) : (
            <div
              className={`w-40 h-40 rounded-md shadow-2xl bg-gradient-to-br ${gradient} flex items-center justify-center`}
            >
              <HeroIcon size={54} className="text-white" fill={isLiked ? 'white' : 'none'} />
            </div>
          )}

          {isPlaylist && cover && (
            <button
              type="button"
              onClick={() => { setPlaylistImage(view.id, null); setCover(null); toast('Cover reset'); }}
              className="tap mt-2 text-[12px] text-spotify-text-subdued underline"
            >
              Reset to song artwork
            </button>
          )}

          {renaming ? (
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
      <div className="shrink-0 flex items-center justify-end gap-4 px-4 pb-3">
        <button
          type="button"
          aria-label="Shuffle play"
          onClick={() => playCollection(tracks, true)}
          disabled={tracks.length === 0}
          className="tap p-1 disabled:opacity-40"
        >
          <Shuffle size={22} className="text-white/70" />
        </button>
        <button
          type="button"
          aria-label="Play"
          onClick={() => playCollection(tracks, false)}
          disabled={tracks.length === 0}
          className="tap w-14 h-14 rounded-full bg-spotify-essential-bright-accent flex items-center justify-center disabled:opacity-40"
        >
          <Play size={26} className="text-black ml-1" fill="black" />
        </button>
      </div>

      {/* Tracks */}
      <div className="scroll-y flex-1">
        {tracks.map((t, i) => (
          <TrackItem
            key={`${t.title}-${t.artist}-${i}`}
            track={t}
            index={i}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            onPlay={() => playFrom(tracks, i)}
            onMenu={onMenu}
          />
        ))}

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
    </div>
  );
}
