import { Play, Music, User, Disc3, WifiOff, AlertTriangle, Search, X } from 'lucide-react';
import { usePlayer } from '../store/PlayerContext';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { cleanText, getBestArtworkUrl, playableTracks, sameTrack } from '../utils/tracks';
import { clickProps } from '../utils/clickable';
import { useLikedSongs, toggleLiked } from '../utils/likes';
import { useRecentSearches, removeRecentSearch, clearRecentSearches } from '../utils/searchHistory';
import { useTrackMenu } from '../utils/useTrackMenu';
import { useRowSelection } from '../utils/useRowSelection';
import { useRovingTabIndex } from '../utils/useRovingTabIndex';
import { TrackRow, TrackListHeader } from './TrackRow';
import { SearchSkeleton } from './Skeleton';
import { api } from '../api';

const TABS = ['All', 'Songs', 'Artists', 'Albums'];

// Module-level cache for the browse/genre tiles so revisiting the Search
// landing is instant. Curated feed → a long TTL is fine (mirrors HomeView).
const _GENRES_TTL_MS = 6 * 60 * 60 * 1000; // 6h, matches the backend cache
let _genresCache = null; // { at, tiles }

// "Browse all" tile grid (curated JioSaavn featured playlists). Each tile opens
// its playlist via the existing jsplaylist route → AlbumView. Self-contained:
// fetches once, renders nothing while empty so the landing never breaks.
function BrowseGrid({ onOpen, fallback = null }) {
  const [tiles, setTiles] = useState(
    _genresCache && (Date.now() - _genresCache.at < _GENRES_TTL_MS) ? _genresCache.tiles : null
  );

  useEffect(() => {
    if (tiles) return; // already have fresh tiles from cache
    let cancelled = false;
    api.getGenres().then(data => {
      if (cancelled) return;
      const list = data?.tiles || [];
      _genresCache = { at: Date.now(), tiles: list };
      setTiles(list);
    });
    return () => { cancelled = true; };
  }, [tiles]);

  if (tiles === null) return null;        // still loading (brief)
  if (tiles.length === 0) return fallback; // loaded empty (e.g. offline)

  return (
    <section className="mb-8">
      <h2 className="text-xl font-bold text-white mb-4">Browse all</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {tiles.map((tile, idx) => (
          <div
            key={idx}
            {...clickProps(() => onOpen?.(tile.name, tile.perma_url), cleanText(tile.name))}
            className="bg-spotify-elevated-base/60 hover:bg-spotify-elevated-highlight rounded-md p-3 cursor-pointer transition-all group"
          >
            <div className="relative mb-3">
              {tile.image ? (
                <img src={tile.image} className="w-full aspect-square object-cover rounded-md shadow-lg" alt="" loading="lazy" />
              ) : (
                <div className="w-full aspect-square bg-spotify-elevated-highlight rounded-md flex items-center justify-center">
                  <Music className="w-10 h-10 text-spotify-text-subdued" />
                </div>
              )}
              <button tabIndex={-1} className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-spotify-essential-bright-accent flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-2xl translate-y-2 group-hover:translate-y-0 transition-all hover:scale-105">
                <Play className="w-4 h-4 text-black ml-0.5" fill="currentColor" />
              </button>
            </div>
            <p className="text-sm font-medium text-white truncate">{cleanText(tile.name)}</p>
            {tile.subtitle && (
              <p className="text-xs text-spotify-text-subdued mt-0.5 truncate">{cleanText(tile.subtitle)}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Module-level sub-components (stable identity → no remount/flicker) ─────────

function TrackTable({ tracks, currentTrack, isPlaying, getArtwork, isLiked, onPlay, onToggleLike, onContextMenu, onOpenArtist, onOpenAlbum, selectedIdx, onSelect }) {
  const roving = useRovingTabIndex(tracks.length, selectedIdx);
  return (
    <div>
      <TrackListHeader />
      <div className="space-y-0.5" {...roving.listProps}>
        {tracks.map((track, idx) => (
          <TrackRow
            key={idx}
            track={track}
            index={idx}
            isCurrent={sameTrack(currentTrack, track)}
            isPlaying={isPlaying}
            selected={selectedIdx === idx}
            onSelect={onSelect}
            tabIndex={roving.tabIndex(idx)}
            onPlay={() => onPlay(track, idx)}
            onMenu={(e) => onContextMenu(e, track)}
            onOpenArtist={onOpenArtist}
            onOpenAlbum={onOpenAlbum}
            artworkUrl={getArtwork(track)}
            liked={isLiked(track)}
            onToggleLike={onToggleLike}
          />
        ))}
      </div>
    </div>
  );
}

function ArtistCards({ artists, onOpen }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {artists.map((artist, idx) => (
        <div
          key={idx}
          {...clickProps(() => onOpen(artist.name), `${artist.name}, Artist`)}
          className="bg-spotify-elevated-base/60 hover:bg-spotify-elevated-highlight rounded-md p-3 cursor-pointer transition-all group text-center"
        >
          <div className="relative mb-3">
            {artist.image || artist.artwork ? (
              <img src={artist.image || artist.artwork} className="w-full aspect-square object-cover rounded-full shadow-lg" alt="" />
            ) : (
              <div className="w-full aspect-square bg-spotify-elevated-highlight rounded-full flex items-center justify-center">
                <User className="w-10 h-10 text-spotify-text-subdued" />
              </div>
            )}
          </div>
          <p className="text-sm font-medium text-white truncate">{artist.name}</p>
          <p className="text-xs text-spotify-text-subdued mt-0.5">Artist</p>
        </div>
      ))}
    </div>
  );
}

function AlbumCards({ albums, onOpen }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {albums.map((album, idx) => (
        <div
          key={idx}
          {...clickProps(() => onOpen(album), `${album.name} by ${album.artist}, Album`)}
          className="bg-spotify-elevated-base/60 hover:bg-spotify-elevated-highlight rounded-md p-3 cursor-pointer transition-all group relative"
        >
          <div className="relative mb-3">
            {album.image ? (
              <img src={album.image} className="w-full aspect-square object-cover rounded-md shadow-lg" alt="" />
            ) : (
              <div className="w-full aspect-square bg-spotify-elevated-highlight rounded-md flex items-center justify-center">
                <Disc3 className="w-10 h-10 text-spotify-text-subdued" />
              </div>
            )}
            <button
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); onOpen(album); }}
              className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-spotify-essential-bright-accent flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-2xl translate-y-2 group-hover:translate-y-0 transition-all hover:scale-105"
            >
              <Play className="w-4 h-4 text-black ml-0.5" fill="currentColor" />
            </button>
          </div>
          <p className="text-sm font-medium text-white truncate">{album.name}</p>
          <p className="text-xs text-spotify-text-subdued mt-0.5 truncate">{album.artist}</p>
        </div>
      ))}
    </div>
  );
}

function SongRow({ track, idx, isCurrent, isPlaying, selected, artworkUrl, liked, onPlay, onToggleLike, onContextMenu, onOpenArtist, onOpenAlbum, onSelect, tabIndex }) {
  return (
    <TrackRow
      track={track}
      index={idx}
      isCurrent={isCurrent}
      isPlaying={isPlaying}
      selected={selected}
      onSelect={onSelect}
      tabIndex={tabIndex}
      onPlay={() => onPlay(track, idx)}
      onMenu={(e) => onContextMenu(e, track)}
      onOpenArtist={onOpenArtist}
      onOpenAlbum={onOpenAlbum}
      artworkUrl={artworkUrl}
      liked={liked}
      onToggleLike={onToggleLike}
    />
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function SearchView({ results, artistResults = [], albumResults = [], loading, searchError, searchQuery, onLikeChange, onSearch, onOpenArtist, onOpenAlbum, onOpenPlaylist }) {
  const { playTrack, currentTrack, isPlaying, setQueue } = usePlayer();
  const likedSongs = useLikedSongs();
  const recentSearches = useRecentSearches();
  const { openMenu, menuElement } = useTrackMenu({ onLibraryChange: onLikeChange, onOpenArtist, onOpenAlbum });
  const [enrichedArt, setEnrichedArt] = useState({}); // title|artist -> url
  const [activeTab, setActiveTab] = useState('All');
  const [selIdx, setSelIdx] = useRowSelection(); // selected (clicked) row, Spotify-style

  // Reset to "All" tab when results change
  useEffect(() => { setActiveTab('All'); setSelIdx(null); }, [results, setSelIdx]);

  // Enrich artwork for tracks missing covers — use ref to avoid re-render loops
  const enrichedArtRef = useRef(enrichedArt);
  enrichedArtRef.current = enrichedArt;

  useEffect(() => {
    if (!results || results.length === 0) return;
    const needArt = playableTracks(results).filter(t => !getBestArtworkUrl(t));
    if (needArt.length === 0) return;

    // 1. Synchronously seed from the persistent artwork cache so covers that
    //    were fetched before show up instantly — even when offline.
    let persisted = {};
    try { persisted = JSON.parse(localStorage.getItem('artworkCache') || '{}'); } catch { /* ignore */ }
    const seed = {};
    for (const track of needArt) {
      const key = `${cleanText(track.title)}|${cleanText(track.artist)}`;
      const cacheKey = key.toLowerCase();
      if (persisted[cacheKey] && !enrichedArtRef.current[key]) {
        seed[key] = persisted[cacheKey];
      }
    }
    if (Object.keys(seed).length > 0) {
      setEnrichedArt(prev => ({ ...prev, ...seed }));
    }

    // 2. Fetch the rest from the network (no-op offline — fails gracefully).
    let cancelled = false;
    (async () => {
      for (const track of needArt.slice(0, 12)) {
        if (cancelled) break;
        const key = `${cleanText(track.title)}|${cleanText(track.artist)}`;
        if (enrichedArtRef.current[key] || seed[key]) continue;
        const url = await api.fetchArtwork(cleanText(track.title), cleanText(track.artist));
        if (!cancelled && url) {
          setEnrichedArt(prev => ({ ...prev, [key]: url }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [results]);

  // Stable getArtwork — uses ref so it doesn't cause useMemo deps to change
  const getArtwork = useCallback((track) => {
    const direct = getBestArtworkUrl(track);
    if (direct) return direct;
    const key = `${cleanText(track.title)}|${cleanText(track.artist)}`;
    return enrichedArtRef.current[key] || '';
  }, []); // stable — never changes, reads from ref

  const isLiked = useCallback((track) => {
    return likedSongs.some(t => cleanText(t.title) === cleanText(track.title) && cleanText(t.artist) === cleanText(track.artist));
  }, [likedSongs]);

  const toggleLike = useCallback((track) => {
    toggleLiked(track);
    if (onLikeChange) onLikeChange();
  }, [onLikeChange]);

  // Derived data for tabs
  const playableResults = useMemo(() => playableTracks(results || []), [results]);
  const topRoving = useRovingTabIndex(Math.min(4, playableResults.length), selIdx);

  // ─── Shared play handlers ─────────────────────────────────────
  const playFromList = useCallback((list, track) => {
    // Play just the chosen song; autoplay radio continues with similar tracks.
    playTrack(track);
    setQueue([]);
  }, [playTrack, setQueue]);

  // Open an album search card → exact release via its JioSaavn album_id (iTunes
  // cards have none → resolved by name+artist, like the "Go to album" path).
  const openAlbumCard = useCallback((album) => {
    onOpenAlbum?.(album.name, album.artist, '', album.album_id);
  }, [onOpenAlbum]);

  // ─── Loading state ────────────────────────────────────────────
  if (loading) return <SearchSkeleton />;

  // ─── Network error state ──────────────────────────────────────
  if (searchError === 'network') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
        <div className="w-20 h-20 rounded-full bg-spotify-elevated-base flex items-center justify-center mb-6">
          <WifiOff className="w-10 h-10 text-spotify-text-subdued" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">You're offline</h2>
        <p className="text-spotify-text-subdued text-sm max-w-md mb-6">
          Please check your internet connection and try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-8 py-3 bg-white text-black text-sm font-bold rounded-full hover:scale-105 transition-transform"
        >
          Try again
        </button>
      </div>
    );
  }

  // ─── Generic error state ──────────────────────────────────────
  if (searchError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
        <div className="w-20 h-20 rounded-full bg-spotify-elevated-base flex items-center justify-center mb-6">
          <AlertTriangle className="w-10 h-10 text-spotify-essential-warning" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Something went wrong</h2>
        <p className="text-spotify-text-subdued text-sm max-w-md">
          {searchError}
        </p>
      </div>
    );
  }

  // ─── Empty state ──────────────────────────────────────────────
  if (!results || results.length === 0) {
    // If a search was actually performed (query present) but came back empty,
    // show "No results" rather than the initial prompt.
    if (searchQuery && searchQuery.trim()) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-spotify-text-subdued gap-2 px-8 text-center">
          <span className="text-2xl font-bold text-white">No results found for "{searchQuery}"</span>
          <span className="text-sm">Please make sure your words are spelled correctly, or try different keywords.</span>
        </div>
      );
    }
    // No query yet → recent searches (if any) + the "Browse all" genre grid.
    return (
      <div className="flex-1 overflow-y-auto px-6 pb-4 pt-4">
        {recentSearches.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Recent searches</h2>
              <button
                onClick={clearRecentSearches}
                className="text-xs text-spotify-text-subdued hover:text-white font-semibold transition-colors"
              >
                Clear all
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {recentSearches.map((q, i) => (
                <div
                  key={i}
                  {...clickProps(() => onSearch?.(q), `Search ${q}`)}
                  className="flex items-center gap-2 bg-spotify-background-tinted-base hover:bg-spotify-background-tinted-highlight rounded-full pl-4 pr-2 py-1.5 cursor-pointer transition-colors"
                >
                  <Search className="w-3.5 h-3.5 text-spotify-text-subdued shrink-0" />
                  <span className="text-sm text-white">{q}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeRecentSearch(q); }}
                    className="text-spotify-text-subdued hover:text-white p-0.5 rounded-full"
                    aria-label={`Remove ${q} from recent searches`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
        <BrowseGrid
          onOpen={onOpenPlaylist}
          fallback={recentSearches.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-spotify-text-subdued gap-2 py-24 text-center">
              <span className="text-2xl font-bold text-white">Search for music</span>
              <span className="text-sm">Find songs, artists, albums, and more</span>
            </div>
          ) : null}
        />
      </div>
    );
  }

  const topTrack = playableResults[0];
  // Top result type: an exact artist-name match wins (Spotify surfaces the artist
  // when you search their name), otherwise the best song. ponytail: exact
  // normalized-name match only — a fuzzy match would let a plain song query get
  // hijacked by a namesake artist; mirrors profile.py's strict _same_artist_name.
  const topArtist = artistResults[0];
  const artistIsTop = topArtist && searchQuery &&
    cleanText(topArtist.name).toLowerCase().replace(/[^a-z0-9]/g, '') ===
    cleanText(searchQuery).toLowerCase().replace(/[^a-z0-9]/g, '');
  const topResult = artistIsTop
    ? { type: 'artist', label: 'Artist', round: true, title: topArtist.name, art: topArtist.image || topArtist.artwork }
    : topTrack
      ? { type: 'song', label: 'Song', round: false, title: cleanText(topTrack.title), subtitle: cleanText(topTrack.artist), art: getArtwork(topTrack) }
      : null;

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-4 pt-4 relative">
      {/* Tab Bar */}
      <div className="flex items-center gap-2 mb-6">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              activeTab === tab
                ? 'bg-white text-black'
                : 'bg-spotify-background-tinted-base text-white hover:bg-spotify-background-tinted-highlight'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ALL Tab */}
      {activeTab === 'All' && (
        <>
          <div className="flex gap-6 mb-8">
            {/* Top Result Card — artist (exact name match) or best song */}
            {topResult && (
              <div
                {...clickProps(() => topResult.type === 'artist'
                  ? onOpenArtist?.(topResult.title)
                  : (playTrack(topTrack), setQueue([])), `${topResult.title}, ${topResult.label}`)}
                className="w-[380px] shrink-0 bg-spotify-elevated-base/60 hover:bg-spotify-elevated-highlight rounded-lg p-5 cursor-pointer transition-all group relative"
              >
                <h3 className="text-sm font-bold text-white mb-4">Top result</h3>
                {topResult.art ? (
                  <img src={topResult.art} className={`w-24 h-24 object-cover shadow-xl mb-4 ${topResult.round ? 'rounded-full' : 'rounded-lg'}`} alt="" />
                ) : (
                  <div className={`w-24 h-24 bg-spotify-elevated-highlight flex items-center justify-center mb-4 ${topResult.round ? 'rounded-full' : 'rounded-lg'}`}>
                    {topResult.type === 'artist'
                      ? <User className="w-8 h-8 text-spotify-text-subdued" />
                      : <Music className="w-8 h-8 text-spotify-text-subdued" />}
                  </div>
                )}
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-3xl font-extrabold text-white truncate">{topResult.title}</h2>
                </div>
                <p className="text-sm text-spotify-text-subdued truncate">
                  {topResult.subtitle}
                  <span className="ml-2 inline-block px-2 py-0.5 bg-black/30 rounded-full text-xs capitalize">{topResult.label}</span>
                </p>
                {topResult.type === 'song' && (
                  <button tabIndex={-1} className="absolute bottom-5 right-5 w-12 h-12 rounded-full bg-spotify-essential-bright-accent flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-2xl translate-y-2 group-hover:translate-y-0 transition-all hover:scale-105">
                    <Play className="w-5 h-5 text-black ml-0.5" fill="currentColor" />
                  </button>
                )}
              </div>
            )}

            {/* Songs (top 4) */}
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-white mb-4">Songs</h3>
              <div className="space-y-0.5" {...topRoving.listProps}>
                {playableResults.slice(0, 4).map((track, idx) => (
                  <SongRow
                    key={idx}
                    track={track}
                    idx={idx}
                    isCurrent={sameTrack(currentTrack, track)}
                    isPlaying={isPlaying}
                    selected={selIdx === idx}
                    artworkUrl={getArtwork(track)}
                    liked={isLiked(track)}
                    tabIndex={topRoving.tabIndex(idx)}
                    onPlay={(t, i) => playFromList(playableResults, t, i)}
                    onToggleLike={toggleLike}
                    onContextMenu={openMenu}
                    onOpenArtist={onOpenArtist}
                    onOpenAlbum={onOpenAlbum}
                    onSelect={setSelIdx}
                  />
                ))}
              </div>
            </div>
          </div>

          {artistResults.length > 0 && (
            <section className="mb-8">
              <h3 className="text-xl font-bold text-white mb-4">Artists</h3>
              <ArtistCards artists={artistResults.slice(0, 5)} onOpen={onOpenArtist} />
            </section>
          )}

          {albumResults.length > 0 && (
            <section className="mb-8">
              <h3 className="text-xl font-bold text-white mb-4">Albums</h3>
              <AlbumCards albums={albumResults.slice(0, 5)} onOpen={openAlbumCard} />
            </section>
          )}
        </>
      )}

      {/* SONGS Tab */}
      {activeTab === 'Songs' && (
        <>
          <h2 className="text-2xl font-bold text-white mb-4">Songs</h2>
          <TrackTable
            tracks={playableResults}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            getArtwork={getArtwork}
            isLiked={isLiked}
            onPlay={(t, i) => playFromList(playableResults, t, i)}
            onToggleLike={toggleLike}
            onContextMenu={openMenu}
            onOpenArtist={onOpenArtist}
            onOpenAlbum={onOpenAlbum}
            selectedIdx={selIdx}
            onSelect={setSelIdx}
          />
        </>
      )}

      {/* ARTISTS Tab */}
      {activeTab === 'Artists' && (
        <>
          <h2 className="text-2xl font-bold text-white mb-4">Artists</h2>
          {artistResults.length > 0 ? (
            <ArtistCards artists={artistResults} onOpen={onOpenArtist} />
          ) : (
            <p className="text-sm text-spotify-text-subdued">No artists found.</p>
          )}
        </>
      )}

      {/* ALBUMS Tab */}
      {activeTab === 'Albums' && (
        <>
          <h2 className="text-2xl font-bold text-white mb-4">Albums</h2>
          {albumResults.length > 0 ? (
            <AlbumCards albums={albumResults} onOpen={openAlbumCard} />
          ) : (
            <p className="text-sm text-spotify-text-subdued">No albums found.</p>
          )}
        </>
      )}

      {/* Context Menu */}
      {menuElement}
    </div>
  );
}
