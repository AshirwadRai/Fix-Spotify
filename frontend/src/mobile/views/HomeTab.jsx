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
export function HomeTab({ onHomeItem, onOpenSettings, updateDot = false }) {
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

  // "Good" stays bold white; the time word carries the colour + a soft entrance
  // so the header feels alive rather than static.
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return { word: 'morning', color: '#f5b301' };   // warm amber
    if (h < 18) return { word: 'afternoon', color: '#1ed760' }; // brand green
    return { word: 'evening', color: '#c084fc' };               // dusk violet
  })();

  return (
    <div className="scroll-y pb-bars h-full">
      <div className="pt-safe">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h1 className="text-[31px] font-black tracking-[-0.035em] leading-none">
            <span className="text-white">Good </span>
            <span
              className="greet-word"
              style={{ color: greeting.color }}
            >
              {greeting.word}
            </span>
          </h1>
          <button
            type="button"
            aria-label="Settings"
            onClick={onOpenSettings}
            className="tap relative p-1 text-white active:text-white"
          >
            <Settings size={24} strokeWidth={2.4} />
            {/* Update waiting inside — the dot survives dismissing the popup. */}
            {updateDot && (
              <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-spotify-essential-bright-accent ring-2 ring-spotify-black" />
            )}
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
        <div className="px-8 py-12 text-center">
          <p className="text-3xl mb-3">🎧</p>
          <p className="text-[15px] font-bold">
            {navigator.onLine ? 'The feed is being shy' : "You're offline"}
          </p>
          <p className="text-[13px] text-spotify-text-subdued mt-1.5 leading-relaxed">
            {navigator.onLine
              ? "We'll keep trying in the background — no need to do anything."
              : 'No internet, no problem — your downloads in Your Library still slap. This screen will wake up on its own when you’re back.'}
          </p>
        </div>
      )}

      {recent.length > 0 && (
        <section className="mt-6">
          <h2 className="text-[19px] font-extrabold tracking-tight px-4 mb-3">Recently played</h2>
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
          <h2 className="text-[19px] font-extrabold tracking-tight px-4 mb-3">{row.title}</h2>
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
