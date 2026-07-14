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
    // Darker and properly glassy: a near-black translucent pane over a heavy
    // blur, with a hairline of light along the top edge to lift it off the
    // content behind. `saturate` is what stops the blurred artwork underneath
    // going grey and muddy — it's the difference between frosted glass and fog.
    <nav
      className="shrink-0 border-t border-white/[0.09] pb-safe"
      style={{
        backgroundColor: 'rgba(9, 9, 11, 0.72)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      }}
    >
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
              {/* Active = BOLDER stroke, not a filled glyph (a solid blob read
                  as a different icon). */}
              <Icon
                size={23}
                strokeWidth={isActive ? 2.6 : 1.8}
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
