import { useState, useEffect } from 'react';
import { Play, Music2 } from 'lucide-react';
import { usePlayer } from '../store/PlayerContext';
import { cleanText, getBestArtworkUrl, readStoredTracks, sameTrack, getTrackId } from '../utils/tracks';
import { clickProps } from '../utils/clickable';
import { HomeSkeleton } from './Skeleton';
import { api } from '../api';

// Module-level session cache: persists across HomeView remounts (navigating
// away and back) so we don't refetch on every visit — BUT with a refresh TTL so
// the time-sensitive feed (charts/trending/new) and the "More like X" row pick
// up the backend's periodic refresh without needing a page reload. Played
// tracks are NOT cached here — they live permanently in localStorage
// (recentlyPlayed) since their data never changes.
const _FEED_TTL_MS = 30 * 60 * 1000; // 30 min — re-pull so a refreshed feed shows up mid-session
let _homeCache = null;        // { at, rows }
let _moreLikeCache = null;    // { at, seedId, data: { title, items } }
const _fresh = (c) => c && (Date.now() - c.at < _FEED_TTL_MS);

// A single Home card. `item` is a self-describing card from /api/home (or a
// locally-built one): { type: 'track'|'album'|'playlist', ... }. The play
// overlay only shows for tracks (albums/playlists open their page on click).
function HomeCard({ item, isCurrent, onClick }) {
  const isTrack = item.type === 'track';
  const round = item.type === 'playlist' ? 'rounded-lg' : 'rounded-md';
  return (
    <div
      {...clickProps(onClick, cleanText(item.title || item.name))}
      className="w-44 shrink-0 rounded-lg p-3 cursor-pointer transition-colors duration-200 group hover:bg-spotify-highlight"
    >
      <div className="relative mb-3">
        {item.image ? (
          <img src={item.image} className={`w-full aspect-square object-cover ${round} shadow-lg`} alt="" loading="lazy" />
        ) : (
          <div className={`w-full aspect-square bg-spotify-elevated-highlight ${round} flex items-center justify-center`}>
            <Music2 className="w-8 h-8 text-spotify-text-subdued" />
          </div>
        )}
        {isTrack && (
          <button tabIndex={-1} className="absolute bottom-2 right-2 w-11 h-11 rounded-full bg-spotify-essential-bright-accent flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-2xl translate-y-2 group-hover:translate-y-0 transition-all hover:scale-105">
            <Play className="w-5 h-5 text-black ml-0.5" fill="currentColor" />
          </button>
        )}
      </div>
      <p className={`text-sm font-semibold truncate ${isCurrent ? 'text-spotify-essential-bright-accent' : 'text-white'}`}>
        {cleanText(item.title || item.name)}
      </p>
      {item.subtitle && (
        <p className="text-xs text-spotify-text-subdued line-clamp-2 mt-0.5">{cleanText(item.subtitle)}</p>
      )}
    </div>
  );
}

// Spotify's signature top-of-home tile: a wide bar with the artwork flush
// left, a bold name, and a green play button that fades in on hover.
function TopTile({ item, isCurrent, onClick }) {
  return (
    <div
      {...clickProps(onClick, cleanText(item.title || item.name))}
      className="group relative flex items-center bg-white/[0.07] hover:bg-white/[0.14] rounded overflow-hidden cursor-pointer transition-colors duration-300 h-14 xl:h-16"
    >
      {item.image ? (
        <img src={item.image} className="h-full aspect-square object-cover shadow-lg shrink-0" alt="" loading="lazy" />
      ) : (
        <div className="h-full aspect-square bg-spotify-elevated-highlight flex items-center justify-center shrink-0">
          <Music2 className="w-5 h-5 text-spotify-text-subdued" />
        </div>
      )}
      <span className={`flex-1 min-w-0 px-3 text-sm font-bold truncate ${isCurrent ? 'text-spotify-essential-bright-accent' : 'text-white'}`}>
        {cleanText(item.title || item.name)}
      </span>
      <button
        tabIndex={-1}
        className="absolute right-2 w-10 h-10 rounded-full bg-spotify-essential-bright-accent flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-xl transition-opacity hover:scale-105"
        aria-hidden="true"
      >
        <Play className="w-4 h-4 text-black ml-0.5" fill="currentColor" />
      </button>
    </div>
  );
}

// A horizontal-scrolling row of cards.
function HomeRow({ title, items, currentTrack, onCardClick }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="text-2xl font-bold text-white mb-4">{title}</h2>
      <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 home-row-scroll">
        {items.map((item, idx) => (
          <HomeCard
            key={idx}
            item={item}
            isCurrent={item.type === 'track' && sameTrack(currentTrack, item.track)}
            onClick={() => onCardClick(item)}
          />
        ))}
      </div>
    </section>
  );
}

export function HomeView({ onNavigate, onOpenAlbum, onOpenPlaylist }) {
  const { playTrack, currentTrack, setQueue } = usePlayer();
  const [greeting, setGreeting] = useState('');
  const [recent, setRecent] = useState([]);
  const [rows, setRows] = useState([]);
  const [moreLike, setMoreLike] = useState(null); // { title, items }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');

    // Recently played (local) → track cards.
    const stored = readStoredTracks('recentlyPlayed').slice(0, 12);
    setRecent(stored.map(t => ({ type: 'track', track: t, title: t.title, subtitle: t.artist, image: getBestArtworkUrl(t) })));

    // Server feed (trending / new / charts / playlists) — cached with a refresh
    // TTL so revisiting Home is instant but a refreshed feed still shows up.
    if (_fresh(_homeCache)) {
      setRows(_homeCache.rows);
      setLoading(false);
    } else {
      api.getHome().then(data => {
        _homeCache = { at: Date.now(), rows: data?.rows || [] };
        setRows(_homeCache.rows);
        setLoading(false);
      });
    }

    // "More like <artist>" — seeded from the most recent distinct play. Cached
    // by seed (so mere navigation doesn't refetch) AND with the refresh TTL, so
    // it updates both when you play something new and on a regular basis.
    if (stored.length > 0) {
      const seed = stored[0];
      const seedId = getTrackId(seed);
      if (_fresh(_moreLikeCache) && _moreLikeCache.seedId === seedId) {
        setMoreLike(_moreLikeCache.data);
      } else {
        api.getRadio(seed.title, seed.artist).then(tracks => {
          const items = (tracks || []).slice(0, 12)
            .filter(t => !sameTrack(t, seed))
            .map(t => ({ type: 'track', track: t, title: t.title, subtitle: t.artist, image: getBestArtworkUrl(t) }));
          if (items.length >= 4) {
            const data = { title: `More like ${cleanText(seed.artist).split(',')[0]}`, items };
            _moreLikeCache = { at: Date.now(), seedId, data };
            setMoreLike(data);
          }
        });
      }
    }
  }, []);

  // Dispatch a card click by its type. Track cards play and queue the rest of
  // their row so the row keeps playing (Spotify-like).
  const handleCard = (rowItems) => (item) => {
    if (item.type === 'track') {
      playTrack(item.track);
      const rest = rowItems.filter(x => x.type === 'track' && x.track !== item.track).map(x => x.track);
      setQueue(rest);
    } else if (item.type === 'album') {
      onOpenAlbum?.(item.name, item.artist);
    } else if (item.type === 'playlist') {
      onOpenPlaylist?.(item.name, item.perma_url);
    }
  };

  const hasContent = recent.length > 0 || rows.length > 0 || moreLike;

  if (loading && !hasContent) return <HomeSkeleton />;

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4">
      <h1 className="text-3xl font-bold tracking-tight text-white mb-6">{greeting}</h1>

      {/* Recently played as Spotify's iconic top tile grid (up to 8) */}
      {recent.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-10">
          {recent.slice(0, 8).map((item, i) => (
            <TopTile
              key={i}
              item={item}
              isCurrent={item.type === 'track' && sameTrack(currentTrack, item.track)}
              onClick={() => handleCard(recent)(item)}
            />
          ))}
        </div>
      )}

      {moreLike && (
        <HomeRow title={moreLike.title} items={moreLike.items} currentTrack={currentTrack} onCardClick={handleCard(moreLike.items)} />
      )}

      {rows.map((row, i) => (
        <HomeRow key={i} title={row.title} items={row.items} currentTrack={currentTrack} onCardClick={handleCard(row.items)} />
      ))}

      {!loading && !hasContent && (
        <div className="mt-8 text-center">
          <p className="text-spotify-text-subdued text-sm mb-4">Nothing to show yet — start exploring</p>
          <button
            onClick={() => onNavigate('search')}
            className="px-6 py-3 bg-white text-black text-sm font-bold rounded-full hover:scale-105 transition-transform"
          >
            Search for music
          </button>
        </div>
      )}
    </div>
  );
}
