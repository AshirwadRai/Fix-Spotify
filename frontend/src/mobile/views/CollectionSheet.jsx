import { useState, useEffect } from 'react';
import { ChevronLeft, Play, Heart, Download, Shuffle } from 'lucide-react';
import { api } from '../../api';
import { usePlayer } from '../../store/PlayerContext';
import { useDownloads } from '../../store/DownloadsContext';
import { TrackItem, CardItem } from '../components/TrackItem';
import { normalizeTracks, cleanText } from '../../utils/tracks';
import { toggleSaved, isSaved } from '../../utils/collections';
import { useDominantColor } from '../../utils/useDominantColor';
import { usePlayFrom } from '../usePlayFrom';

/**
 * Full-screen detail page for an album, playlist, or artist.
 *
 * One component covers all three because they render the same way on a phone —
 * a tinted hero, a play button, and a track list. `target.type` picks which API
 * call fills it.
 */
export function CollectionSheet({ target, onClose, onMenu, onOpenArtist, onOpenAlbum }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  const { currentTrack, isPlaying, playCollection } = usePlayer();
  const playFrom = usePlayFrom();
  const { downloadMany } = useDownloads();

  const image = data?.image || data?.artwork_url || target?.image || '';
  const rgb = useDominantColor(image);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoading(true);
    setData(null);

    const fetcher = (() => {
      // Home rails hand back playlist tiles keyed by perma_url; search hands
      // back albums with an album_id; artist rows just have a name.
      if (target.type === 'artist') return api.getArtist(target.name);
      if (target.type === 'playlist' || target.perma_url) {
        return api.getPlaylist(target.perma_url || target.url);
      }
      return api.getAlbum(
        target.name || '',
        target.artist || '',
        target.song_url || '',
        target.album_id || ''
      );
    })();

    fetcher
      .then((res) => {
        if (cancelled || !res) return;
        setData(res);
        setSaved(isSaved({ name: res.name, artist: res.artist, type: target.type || 'album' }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [target]);

  if (!target) return null;

  const tracks = normalizeTracks(data?.tracks || data?.top_songs || []);
  const isArtist = target.type === 'artist';
  const bg = rgb ? `rgb(${rgb})` : '#333';

  return (
    <div className="absolute inset-0 z-20 bg-spotify-base flex flex-col">
      {/* Hero */}
      <div
        className="shrink-0 pt-safe"
        style={{ background: `linear-gradient(180deg, ${bg} 0%, rgba(18,18,18,0.9) 100%)` }}
      >
        <div className="flex items-center h-14 px-2">
          <button type="button" onClick={onClose} aria-label="Back" className="tap p-2">
            <ChevronLeft size={26} />
          </button>
        </div>

        <div className="px-4 pb-4 flex flex-col items-center">
          <div
            className={`w-40 h-40 bg-black/30 overflow-hidden shadow-2xl ${
              isArtist ? 'rounded-full' : 'rounded-md'
            }`}
          >
            {image ? <img src={image} alt="" className="w-full h-full object-cover" /> : null}
          </div>

          <h1 className="text-2xl font-bold text-center mt-4 line-clamp-2">
            {cleanText(data?.name || target.name)}
          </h1>
          {!isArtist && (
            <p className="text-[13px] text-white/70 mt-1 text-center">
              {cleanText(data?.artist || target.artist)}
              {tracks.length > 0 ? ` · ${tracks.length} songs` : ''}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-4 px-4 py-3 bg-spotify-base">
        {!isArtist && (
          <>
            <button
              type="button"
              aria-label={saved ? 'Remove from library' : 'Save to library'}
              onClick={() => {
                toggleSaved({
                  name: data?.name || target.name,
                  artist: data?.artist || target.artist,
                  image,
                  type: target.type || 'album',
                  perma_url: target.perma_url,
                  album_id: target.album_id,
                  tracks,
                });
                setSaved((v) => !v);
              }}
              className="tap p-1"
            >
              <Heart
                size={24}
                className={saved ? 'text-spotify-essential-bright-accent' : 'text-white/70'}
                fill={saved ? 'currentColor' : 'none'}
              />
            </button>
            <button
              type="button"
              aria-label="Download all"
              onClick={() => downloadMany(tracks)}
              className="tap p-1"
              disabled={tracks.length === 0}
            >
              <Download size={24} className="text-white/70" />
            </button>
          </>
        )}

        <div className="flex-1" />

        <button
          type="button"
          aria-label="Shuffle play"
          onClick={() => playCollection(tracks, true)}
          className="tap p-1"
          disabled={tracks.length === 0}
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
        {loading && (
          <div className="px-4 space-y-3 pt-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-12 h-12 rounded bg-white/10 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/3 bg-white/10 rounded animate-pulse" />
                  <div className="h-3 w-1/3 bg-white/10 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading &&
          tracks.map((t, i) => (
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

        {/* Artist pages also carry albums and similar artists. */}
        {isArtist && data?.albums?.length > 0 && (
          <section className="mt-6">
            <h2 className="text-lg font-bold px-4 mb-3">Albums</h2>
            <div className="rail px-4">
              {data.albums.map((a, i) => (
                <CardItem
                  key={`${a.name}-${i}`}
                  image={a.image}
                  title={a.name}
                  subtitle={a.year}
                  onClick={() => onOpenAlbum({ ...a, type: 'album' })}
                />
              ))}
            </div>
          </section>
        )}

        {isArtist && data?.similar_artists?.length > 0 && (
          <section className="mt-6">
            <h2 className="text-lg font-bold px-4 mb-3">Fans also like</h2>
            <div className="rail px-4">
              {data.similar_artists.map((a, i) => (
                <CardItem
                  key={`${a.name}-${i}`}
                  image={a.image}
                  title={a.name}
                  round
                  width="w-28"
                  onClick={() => onOpenArtist(a.name)}
                />
              ))}
            </div>
          </section>
        )}

        {!loading && tracks.length === 0 && (
          <p className="text-center text-spotify-text-subdued text-sm mt-16 px-8">
            Couldn&apos;t load any tracks for this one.
          </p>
        )}

        <div className="h-6" />
      </div>
    </div>
  );
}
