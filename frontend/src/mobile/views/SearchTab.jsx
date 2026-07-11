import { useState, useRef, useCallback } from 'react';
import { Search, X, Clock } from 'lucide-react';
import { api } from '../../api';
import { TrackItem, CardItem } from '../components/TrackItem';
import { normalizeTracks, applyEnrichment } from '../../utils/tracks';
import { useRecentSearches, addRecentSearch, removeRecentSearch } from '../../utils/searchHistory';
import { usePlayer } from '../../store/PlayerContext';
import { usePlayFrom } from '../usePlayFrom';
import { isSpotifyUrl } from '../components/SpotifyImportSheet';

export function SearchTab({ onMenu, onOpenArtist, onOpenAlbum, onImportSpotify }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [artists, setArtists] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const { currentTrack, isPlaying } = usePlayer();
  const playFrom = usePlayFrom();
  const recents = useRecentSearches();
  const inputRef = useRef(null);
  const reqIdRef = useRef(0);

  const runSearch = useCallback(async (q) => {
    const term = q.trim();
    if (!term) return;

    // A pasted Spotify playlist/album link isn't a search — it's an import.
    if (isSpotifyUrl(term)) {
      inputRef.current?.blur();
      onImportSpotify(term);
      return;
    }

    // Every search gets a ticket. A slow earlier request that lands after a
    // newer one must not overwrite the fresher results.
    const ticket = ++reqIdRef.current;

    setLoading(true);
    setSearched(true);
    addRecentSearch(term);
    inputRef.current?.blur();     // drop the keyboard so results are visible

    try {
      const [tracksRes, artistsRes, albumsRes] = await Promise.all([
        api.search(term, { limit: 30 }),
        api.searchArtists(term),
        api.searchAlbums(term),
      ]);
      if (ticket !== reqIdRef.current) return;

      const tracks = normalizeTracks(tracksRes.results || []);
      setResults(tracks);
      setArtists(artistsRes || []);
      setAlbums(albumsRes || []);

      // Clean metadata + hi-res art arrive after the results are already on
      // screen, so the list feels instant and then sharpens.
      api.enrichBatch(tracks).then((enrichments) => {
        if (ticket !== reqIdRef.current) return;
        setResults((prev) =>
          prev.map((t, i) => (enrichments[i] ? applyEnrichment(t, enrichments[i]) : t))
        );
      });
    } catch {
      if (ticket === reqIdRef.current) {
        setResults([]);
        setArtists([]);
        setAlbums([]);
      }
    } finally {
      if (ticket === reqIdRef.current) setLoading(false);
    }
  }, [onImportSpotify]);

  const clear = () => {
    setQuery('');
    setResults([]);
    setArtists([]);
    setAlbums([]);
    setSearched(false);
    reqIdRef.current++;   // invalidate anything in flight
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="pt-safe shrink-0 bg-spotify-black">
        <div className="px-4 pt-4 pb-3">
          <h1 className="text-2xl font-bold mb-3">Search</h1>
          <form
            onSubmit={(e) => { e.preventDefault(); runSearch(query); }}
            className="relative"
          >
            <Search
              size={20}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-black/60 pointer-events-none"
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="search"
              enterKeyHint="search"
              placeholder="Songs, artists, or a Spotify link"
              className="w-full h-12 pl-11 pr-10 rounded bg-white text-black text-[15px] placeholder:text-black/50 outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={clear}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-black/60"
              >
                <X size={18} />
              </button>
            )}
          </form>
        </div>
      </div>

      <div className="scroll-y flex-1">
        {/* Recent searches — shown until the first search of the session */}
        {!searched && (
          <div className="px-4 pt-2">
            {recents.length > 0 && (
              <h2 className="text-base font-bold mb-2">Recent searches</h2>
            )}
            {recents.map((r) => (
              <div key={r} className="flex items-center gap-3 py-2.5">
                <Clock size={18} className="text-spotify-text-subdued shrink-0" />
                <button
                  type="button"
                  onClick={() => { setQuery(r); runSearch(r); }}
                  className="flex-1 text-left text-[15px] truncate"
                >
                  {r}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${r}`}
                  onClick={() => removeRecentSearch(r)}
                  className="p-2 text-spotify-text-subdued"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            {recents.length === 0 && (
              <p className="text-center text-spotify-text-subdued text-sm mt-16 px-8">
                Search across JioSaavn and SoundCloud.
              </p>
            )}
          </div>
        )}

        {loading && (
          <div className="px-4 space-y-3 pt-4">
            {[...Array(8)].map((_, i) => (
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

        {!loading && searched && (
          <>
            {artists.length > 0 && (
              <section className="mt-4">
                <h2 className="text-lg font-bold px-4 mb-3">Artists</h2>
                <div className="rail px-4">
                  {artists.slice(0, 10).map((a) => (
                    <CardItem
                      key={a.name}
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

            {albums.length > 0 && (
              <section className="mt-6">
                <h2 className="text-lg font-bold px-4 mb-3">Albums</h2>
                <div className="rail px-4">
                  {albums.slice(0, 10).map((a, i) => (
                    <CardItem
                      key={`${a.name}-${i}`}
                      image={a.image}
                      title={a.name}
                      subtitle={a.artist}
                      onClick={() => onOpenAlbum(a)}
                    />
                  ))}
                </div>
              </section>
            )}

            {results.length > 0 && (
              <section className="mt-6">
                <h2 className="text-lg font-bold px-4 mb-1">Songs</h2>
                {results.map((t, i) => (
                  <TrackItem
                    key={`${t.title}-${t.artist}-${i}`}
                    track={t}
                    index={i}
                    currentTrack={currentTrack}
                    isPlaying={isPlaying}
                    onPlay={() => playFrom(results, i)}
                    onMenu={onMenu}
                  />
                ))}
              </section>
            )}

            {results.length === 0 && artists.length === 0 && albums.length === 0 && (
              <p className="text-center text-spotify-text-subdued text-sm mt-16 px-8">
                No results for &ldquo;{query}&rdquo;.
              </p>
            )}
          </>
        )}

        <div className="h-6" />
      </div>
    </div>
  );
}
