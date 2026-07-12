import { useState, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { api } from '../../api';
import { CardItem } from '../components/TrackItem';
import { normalizeTracks } from '../../utils/tracks';

function readRecent() {
  try {
    return normalizeTracks(JSON.parse(localStorage.getItem('recentlyPlayed') || '[]')).slice(0, 12);
  } catch {
    return [];
  }
}

/**
 * The discover feed: horizontal rails of JioSaavn charts, trending, and new
 * releases. Rails (not the desktop grid) because horizontal swiping is how a
 * phone browses many items in little vertical space.
 *
 * `onHomeItem(item, rowItems)` routes a card by its type — a track plays
 * immediately, an album/playlist opens. Sending everything to the collection
 * view was the "couldn't load any tracks" bug: a single-song card was being
 * fetched as if it were an album.
 */
export function HomeTab({ onHomeItem, onOpenSettings }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recent, setRecent] = useState(readRecent);

  // Refresh recents whenever the tab regains focus (a song may have played since).
  useEffect(() => {
    const refresh = () => setRecent(readRecent());
    window.addEventListener('focus', refresh);
    window.addEventListener('recentlyplayedchange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('recentlyplayedchange', refresh);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retry = null;

    const load = () => {
      setLoading(true);
      api
        .getHome()
        .then((data) => {
          if (cancelled) return;
          const got = data.rows || [];
          setRows(got);
          // Still empty? The connection is probably down. Poll quietly until it
          // comes back — the WebView's 'online' event is unreliable on Android,
          // so we can't wait for it. Clear the timer the moment we succeed.
          if (got.length === 0) {
            retry = setTimeout(load, 4000);
          } else if (retry) {
            clearTimeout(retry);
            retry = null;
          }
        })
        .catch(() => { if (!cancelled) retry = setTimeout(load, 4000); })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    load();

    // Also react to the confirmed-reconnect signal when it does fire.
    const onReconnect = () => load();
    window.addEventListener('app:reconnected', onReconnect);
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      window.removeEventListener('app:reconnected', onReconnect);
    };
  }, []);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <div className="scroll-y h-full">
      <div className="pt-safe">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h1 className="text-2xl font-bold">{greeting}</h1>
          <button
            type="button"
            aria-label="Settings"
            onClick={onOpenSettings}
            className="tap p-1 text-spotify-text-subdued active:text-white"
          >
            <Settings size={24} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="px-4 space-y-6 pt-4">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div className="h-5 w-40 bg-white/10 rounded mb-3 animate-pulse" />
              <div className="flex gap-3">
                {[0, 1, 2].map((j) => (
                  <div key={j} className="w-36 shrink-0">
                    <div className="w-full aspect-square bg-white/10 rounded-md animate-pulse" />
                    <div className="h-3 w-24 bg-white/10 rounded mt-2 animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <p className="px-4 py-10 text-center text-spotify-text-subdued text-sm">
          Couldn&apos;t load the feed. Check your connection and try again.
        </p>
      )}

      {recent.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-bold px-4 mb-3">Recently played</h2>
          <div className="rail px-4">
            {recent.map((t, i) => (
              <CardItem
                key={`recent-${t.title}-${i}`}
                image={t.artwork_url || t.image}
                title={t.title}
                subtitle={t.artist}
                onClick={() => onHomeItem({ ...t, type: 'track' }, recent)}
              />
            ))}
          </div>
        </section>
      )}

      {rows.map((row) => (
        <section key={row.title} className="mt-6">
          <h2 className="text-lg font-bold px-4 mb-3">{row.title}</h2>
          <div className="rail px-4">
            {(row.items || []).map((item, i) => (
              <CardItem
                key={`${item.name || item.title}-${i}`}
                image={item.image || item.artwork_url}
                title={item.name || item.title}
                subtitle={item.subtitle || item.artist}
                // A track card is round only if it's an artist; keep square here.
                onClick={() => onHomeItem(item, row.items || [])}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="h-4" />
    </div>
  );
}
