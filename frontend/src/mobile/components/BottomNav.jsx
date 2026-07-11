import { Home, Search, Library, Download } from 'lucide-react';

const TABS = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'search', label: 'Search', Icon: Search },
  { id: 'library', label: 'Library', Icon: Library },
  { id: 'downloads', label: 'Downloads', Icon: Download },
];

/**
 * The primary navigation — four icon-only destinations, always visible and
 * thumb-reachable. No text labels and no active "pill" behind the icon: the
 * active tab is signalled purely by a brighter icon + a slightly heavier
 * stroke, which keeps the bar clean and lets the gradient/background show
 * through.
 */
export function BottomNav({ active, onChange }) {
  return (
    <nav className="shrink-0 bg-spotify-base/95 backdrop-blur border-t border-white/[0.06] pb-safe">
      <div className="flex items-stretch">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
              className="flex-1 flex items-center justify-center py-3.5 tap"
            >
              <Icon
                size={27}
                strokeWidth={isActive ? 2.4 : 1.9}
                className={
                  isActive
                    ? 'text-white'
                    : 'text-spotify-essential-subdued'
                }
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
