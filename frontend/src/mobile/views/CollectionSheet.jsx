import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, Play, Pause, Heart, Download, Shuffle } from 'lucide-react';
import { api } from '../../api';
import { usePlayer } from '../../store/PlayerContext';
import { useDownloads } from '../../store/DownloadsContext';
import { TrackItem, CardItem } from '../components/TrackItem';
import { normalizeTracks, cleanText, sameTrack } from '../../utils/tracks';
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

  const { currentTrack, isPlaying, playCollection, shuffle, togglePlay } = usePlayer();
  const playFrom = usePlayFrom();
  const { downloadMany } = useDownloads();

  const image = data?.image || data?.artwork_url || target?.image || '';
  const rgb = useDominantColor(image);

  // Scroll-linked hero collapse. `fade` runs 0 -> 1 over the first HERO_FADE_PX
  // of scroll: the portrait dissolves and drifts up while the songs rise over
  // it, and the compact title fades in to take its place.
  //
  // rAF-gated because scroll fires far faster than the screen refreshes, and a
  // setState per event would queue renders the user never sees. Only opacity and
  // transform are animated — both composite on the GPU, so the list stays smooth.
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
      .then(async (res) => {
        if (cancelled) return;
        const got = res || {};
        const hasTracks = (got.tracks || got.top_songs || []).length > 0;

        // Some home-feed tiles arrive with no album_id / perma_url, so the
        // backend has nothing to resolve and returns an empty tracklist — which
        // showed as a dead "couldn't load any tracks". Rather than a dead end,
        // search songs by the title (and artist) so the user still gets a
        // playable list.
        if (!hasTracks) {
          const q = [target.name, target.artist].filter(Boolean).join(' ').trim();
          if (q) {
            try {
              const sr = await api.search(q, { limit: 30 });
              if (cancelled) return;
              const found = sr.results || [];
              if (found.length) {
                setData({ ...got, name: got.name || target.name, tracks: found });
                setSaved(isSaved({ name: target.name, artist: target.artist, type: target.type || 'album' }));
                return;
              }
            } catch { /* fall through to whatever we had */ }
          }
        }

        setData(got);
        setSaved(isSaved({ name: got.name, artist: got.artist, type: target.type || 'album' }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [target]);

  if (!target) return null;

  const tracks = normalizeTracks(data?.tracks || data?.top_songs || []);
  const playingThis = !!currentTrack && tracks.some((t) => sameTrack(t, currentTrack));
  const isArtist = target.type === 'artist';
  const bg = rgb ? `rgb(${rgb})` : '#333';

  return (
    <div className="absolute inset-0 z-20 bg-spotify-base flex flex-col">
      {/* Sticky bar. It starts transparent over the hero and turns solid as the
          hero dissolves, so the back button is always legible against whatever
          is behind it. */}
      <div
        className="shrink-0 pt-safe relative z-10 transition-shadow duration-base"
        style={{
          background: fade > 0.02
            ? `rgba(18,18,18,${0.35 + fade * 0.6})`
            : 'transparent',
          backdropFilter: fade > 0.02 ? 'blur(12px)' : 'none',
        }}
      >
        <div className="flex items-center h-14 px-2 gap-1">
          <button type="button" onClick={onClose} aria-label="Back" className="tap p-2 shrink-0">
            <ChevronLeft size={26} />
          </button>
          {/* Takes over from the hero title, rather than duplicating it. */}
          <h2
            className="min-w-0 flex-1 truncate text-[16px] font-bold"
            style={{ opacity: Math.max(0, (fade - 0.55) / 0.45) }}
            aria-hidden={fade < 0.55}
          >
            {cleanText(data?.name || target.name)}
          </h2>
        </div>
      </div>

      {/* The hero now lives INSIDE the scroll region, so it travels away with
          the content instead of being pinned above it. */}
      <div className="scroll-y flex-1 -mt-14" onScroll={onScroll}>
        <div
          className="pt-14"
          style={{ background: `linear-gradient(180deg, ${bg} 0%, rgba(18,18,18,0.9) 100%)` }}
        >
          <div
            className="px-4 pb-4 pt-4 flex flex-col items-center will-change-transform"
            style={{
              opacity: 1 - fade,
              // Drifts up slightly faster than the scroll, so the songs feel like
              // they're rising over it rather than pushing it.
              transform: `translateY(${fade * -28}px) scale(${1 - fade * 0.08})`,
            }}
          >
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
      <div className="flex items-center gap-4 px-4 py-3 bg-spotify-base">
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
          className={`tap p-1 transition-colors duration-fast ${
            playingThis && shuffle ? 'text-spotify-essential-bright-accent' : 'text-white/70'
          }`}
          disabled={tracks.length === 0}
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

      {/* Tracks — inside the same scroll container as the hero above. */}
      <div>
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
    </div>
  );
}
