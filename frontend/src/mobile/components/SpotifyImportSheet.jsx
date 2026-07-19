import { useState, useEffect } from 'react';
import { ChevronLeft, Play, Plus, Loader2, AlertCircle, Check } from 'lucide-react';
import { api } from '../../api';
import { usePlayer } from '../../store/PlayerContext';
import { TrackItem } from './TrackItem';
import { normalizeTracks, cleanText } from '../../utils/tracks';
import { usePlayFrom } from '../usePlayFrom';
import { createPlaylist, addTrackToPlaylist } from '../usePlaylists';
import { toast } from '../../utils/toast';

/** True for a public Spotify playlist/album link (or spotify: URI). */
export function isSpotifyUrl(text) {
  const s = (text || '').trim();
  return (
    /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(playlist|album)\//i.test(s) ||
    /^spotify:(playlist|album):/i.test(s)
  );
}

/**
 * Imports a Spotify playlist/album into the app.
 *
 * Spotify is NOT a playback source — we read its tracklist and re-find each song
 * on JioSaavn/SoundCloud, so the result is a normal, fully playable list. Saving
 * it creates an ordinary local playlist, which means it's editable afterwards
 * (add/remove songs) like any other.
 */
export function SpotifyImportSheet({ url, onClose, onMenu }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  const { currentTrack, isPlaying, playCollection } = usePlayer();
  const playFrom = usePlayFrom();

  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    setLoading(true);
    setData(null);
    setSaved(false);

    api.importSpotify(url).then((res) => {
      if (!cancelled) setData(res);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [url]);

  if (!url) return null;

  const tracks = normalizeTracks(data?.tracks || []);
  const missing = data?.missing || [];

  const saveToLibrary = () => {
    const pl = createPlaylist(data?.name || 'Spotify playlist');
    if (!pl) return;
    tracks.forEach((t) => addTrackToPlaylist(pl.id, t));
    setSaved(true);
    toast(`Saved “${pl.name}” to your library`);
  };

  return (
    <div className="absolute inset-0 z-20 bg-spotify-base flex flex-col">
      <div className="shrink-0 pt-safe bg-gradient-to-b from-[#1db954]/25 to-transparent">
        <div className="flex items-center h-14 px-2">
          <button type="button" onClick={onClose} aria-label="Back" className="tap p-2">
            <ChevronLeft size={26} />
          </button>
        </div>

        <div className="px-4 pb-4 flex flex-col items-center">
          {/* The cover only appears once we have one — an empty grey square while
              loading read as a broken image. */}
          {data?.image && (
            <div className="w-36 h-36 rounded-md overflow-hidden shadow-2xl">
              <img src={data.image} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <h1 className="text-xl font-bold text-center mt-4 line-clamp-2">
            {loading ? 'Importing from Spotify…' : cleanText(data?.name) || 'Spotify playlist'}
          </h1>
          {!loading && !data?.error && (
            <p className="text-[13px] text-spotify-text-subdued mt-1 text-center">
              {data?.matched} of {data?.total} songs found
            </p>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-10">
          <Loader2 size={28} className="animate-spin text-spotify-essential-bright-accent" />
          <p className="text-sm text-spotify-text-subdued text-center">
            Finding each song across your music sources. This can take a moment for
            a long playlist.
          </p>
        </div>
      )}

      {!loading && data?.error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-10">
          <AlertCircle size={28} className="text-spotify-essential-negative" />
          <p className="text-sm text-spotify-text-subdued text-center">{data.error}</p>
          <p className="text-xs text-spotify-essential-subdued text-center">
            The playlist has to be public for this to work.
          </p>
        </div>
      )}

      {!loading && !data?.error && (
        <>
          <div className="shrink-0 flex items-center gap-3 px-4 pb-3">
            <button
              type="button"
              onClick={saveToLibrary}
              disabled={saved || tracks.length === 0}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full bg-white/10 text-[14px] font-semibold disabled:opacity-50"
            >
              {saved ? <Check size={17} /> : <Plus size={17} />}
              {saved ? 'Saved to library' : 'Add to library'}
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

          <div className="scroll-y pb-bars flex-1">
            {tracks.map((t, i) => (
              <TrackItem
                key={`${t.title}-${i}`}
                track={t}
                index={i}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                onPlay={() => playFrom(tracks, i)}
                onMenu={onMenu}
              />
            ))}

            {/* Be explicit about what didn't come across, rather than quietly
                shipping a shorter playlist than the user expected. */}
            {missing.length > 0 && (
              <section className="mt-4 px-4">
                <h2 className="text-xs uppercase tracking-wider text-spotify-text-subdued py-2">
                  Not found ({missing.length})
                </h2>
                {missing.map((m) => (
                  <p key={m} className="text-[13px] text-spotify-essential-subdued py-1 truncate">
                    {m}
                  </p>
                ))}
              </section>
            )}

            <div className="h-6" />
          </div>
        </>
      )}
    </div>
  );
}
