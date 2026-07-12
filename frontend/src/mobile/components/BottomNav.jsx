import { Home, Search, Library } from 'lucide-react';

const TABS = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'search', label: 'Search', Icon: Search },
  { id: 'library', label: 'Your Library', Icon: Library },
];

/**
 * Primary navigation — three thumb-reachable destinations with a label under
 * each icon (Spotify's own pattern; a bare icon makes "Library" ambiguous).
 *
 * The bar is lightly glassy — a translucent surface with a blur — so the
 * artwork/gradient of whatever is playing bleeds through a touch and the app
 * reads as layered rather than a flat opaque strip. The active tab fills its
 * icon and brightens its label; inactive stays outlined and subdued. Motion is
 * state-only: colour + a hair of scale on press, nothing decorative.
 */
export function BottomNav({ active, onChange }) {
  return (
    <nav className="shrink-0 border-t border-white/[0.06] bg-spotify-base/70 backdrop-blur-xl pb-safe">
      <div className="flex items-stretch">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-current={isActive ? 'page' : undefined}
              className="tap flex flex-1 flex-col items-center gap-1 py-2.5"
            >
              <Icon
                size={23}
                strokeWidth={isActive ? 2.3 : 1.9}
                fill={isActive ? 'currentColor' : 'none'}
                className={`transition-colors duration-fast ${
                  isActive ? 'text-white' : 'text-spotify-essential-subdued'
                }`}
              />
              <span
                className={`text-[10px] leading-none tracking-wide transition-colors duration-fast ${
                  isActive
                    ? 'font-semibold text-white'
                    : 'font-medium text-spotify-essential-subdued'
                }`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
