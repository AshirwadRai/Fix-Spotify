import { useState, useEffect } from 'react';
import { ChevronLeft, Play, Plus, AlertCircle, Check } from 'lucide-react';
import { usePlayer } from '../../store/PlayerContext';
import { TrackItem } from './TrackItem';
import { normalizeTracks, cleanText } from '../../utils/tracks';
import { usePlayFrom } from '../usePlayFrom';
import { createPlaylist, addTrackToPlaylist } from '../usePlaylists';
import { startImport, useSpotifyImport } from '../spotifyImport';
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
  // Track the URL that was saved rather than a bare boolean, so "saved" resets
  // by itself when a different playlist is opened — no effect, no lint noise.
  const [savedUrl, setSavedUrl] = useState(null);
  const saved = savedUrl === url;

  const { currentTrack, isPlaying, playCollection } = usePlayer();
  const playFrom = usePlayFrom();

  // Progress lives in a module-level store, so leaving this screen doesn't stop
  // the import — the backend job keeps matching and this picks up exact progress
  // when the screen comes back. Starting is idempotent for the same URL.
  const data = useSpotifyImport();
  useEffect(() => { if (url) startImport(url); }, [url]);

  if (!url) return null;

  // The store may briefly hold a previous URL's snapshot for one frame after the
  // URL changes; treat a mismatch as "still loading this one".
  const active = data.url === url ? data : { finished: false, done: 0, total: 0, tracks: [], missing: [] };
  const loading = !active.finished && !active.error;
  const tracks = normalizeTracks(active.tracks || []);
  const missing = active.missing || [];
  const pct = active.total > 0 ? Math.round((active.done / active.total) * 100) : 0;

  const saveToLibrary = () => {
    const pl = createPlaylist(active.name || 'Spotify playlist');
    if (!pl) return;
    tracks.forEach((t) => addTrackToPlaylist(pl.id, t));
    setSavedUrl(url);
    // NOT clearImport(): wiping the store here nulls its url, which makes
    // `active` fall back to the placeholder below — flipping this screen from
    // the saved tracklist straight back to the progress bar. A finished job
    // costs nothing to keep (the resume banner only shows unfinished ones).
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
          {active.image && (
            <div className="w-36 h-36 rounded-md overflow-hidden shadow-2xl">
              <img src={active.image} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <h1 className="text-xl font-bold text-center mt-4 line-clamp-2">
            {loading ? (cleanText(active.name) || 'Importing from Spotify…') : cleanText(active.name) || 'Spotify playlist'}
          </h1>
          {!loading && !active.error && (
            <p className="text-[13px] text-spotify-text-subdued mt-1 text-center">
              {active.matched} of {active.total} songs found
            </p>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-10">
          {/* A real progress bar — how many songs matched so far, out of the
              total. Determinate once the tracklist is known; a slim indeterminate
              feel before that (total 0). */}
          <div className="w-full max-w-xs">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-spotify-essential-bright-accent transition-[width] duration-300"
                style={{ width: `${active.total > 0 ? pct : 8}%` }}
              />
            </div>
            <p className="mt-3 text-center text-[13px] font-semibold tabular-nums">
              {active.total > 0
                ? `${active.done} of ${active.total} songs`
                : 'Reading the playlist…'}
            </p>
          </div>
          <p className="text-xs text-spotify-text-subdued text-center">
            Finding each song across your music sources. You can keep browsing —
            this carries on in the background.
          </p>
        </div>
      )}

      {!loading && active.error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-10">
          <AlertCircle size={28} className="text-spotify-essential-negative" />
          <p className="text-sm text-spotify-text-subdued text-center">{active.error}</p>
          <p className="text-xs text-spotify-essential-subdued text-center">
            The playlist has to be public for this to work.
          </p>
        </div>
      )}

      {!loading && !active.error && (
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
