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
    // Proper frosted glass: a thin dark pane over a heavy blur, so the artwork
    // and artwork-tinted content scrolling underneath actually reads through it.
    //
    // The tint is deliberately LIGHT (0.55, not 0.8) — the darker it gets, the
    // more it just becomes an opaque bar again, and the glass stops being visible
    // as glass. `saturate` is what keeps the colour underneath alive instead of
    // letting the blur wash it to grey; that's the whole difference between
    // frosted glass and fog.
    //
    // THE SHAKE. A backdrop-filter element with no compositing layer of its own
    // is re-rasterised against the content moving behind it on every scroll
    // frame, and the WebView lands those repaints a frame late — so the bar
    // appeared to wobble as you scrolled Home.
    //
    // translateZ(0) + will-change promotes it to its own layer, and
    // `contain: paint` tells the compositor nothing inside it can affect
    // anything outside, so it stops being re-laid-out with the scroller.
    <nav
      className="shrink-0 pb-safe"
      style={{
        backgroundColor: 'rgba(12, 12, 14, 0.55)',
        backdropFilter: 'blur(32px) saturate(200%)',
        WebkitBackdropFilter: 'blur(32px) saturate(200%)',
        transform: 'translateZ(0)',
        willChange: 'transform',
        contain: 'paint',
        // A soft lift so the bar sits ON the content rather than being cut out of it.
        boxShadow: '0 -1px 24px rgba(0, 0, 0, 0.45)',
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
