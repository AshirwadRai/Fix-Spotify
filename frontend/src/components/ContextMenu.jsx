import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * Reusable context menu with dynamic viewport-aware positioning.
 * Rendered through a portal to document.body so it always positions
 * relative to the viewport — immune to transformed ancestors that would
 * otherwise create a containing block for position:fixed elements.
 *
 * Props:
 *   items: Array<{ label, icon?: Component, onClick?, submenu?: items[], divider?: bool, destructive?: bool }>
 *   position: { x, y } — anchor point (will be clamped to viewport)
 *   onClose: () => void
 */
export function ContextMenu({ items, position, onClose }) {
  const menuRef = useRef(null);
  const [activeSubmenu, setActiveSubmenu] = useState(null);
  const [menuStyle, setMenuStyle] = useState({ left: 0, top: 0, opacity: 0 });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const submenuTimerRef = useRef(null);

  // Position menu on mount, clamped to viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const pad = 8;
    let x = position.x;
    let y = position.y;

    if (x + rect.width > window.innerWidth - pad) {
      x = window.innerWidth - rect.width - pad;
    }
    if (x < pad) x = pad;

    if (y + rect.height > window.innerHeight - pad) {
      y = position.y - rect.height;
      if (y < pad) y = pad;
    }

    setMenuStyle({ left: x, top: y, opacity: 1 });
  }, [position]);

  // Close on outside click and Escape — use ref to avoid effect churn
  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onCloseRef.current();
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    // Use a microtask delay so the opening click doesn't immediately close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []); // stable — no deps, uses ref

  // Lock background scrolling while the menu is open (Spotify behavior): the
  // list must not scroll out from under an open menu. Wheel/touch over the menu
  // itself is still allowed so a tall submenu can scroll if needed.
  useEffect(() => {
    const lock = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) e.preventDefault();
    };
    document.addEventListener('wheel', lock, { passive: false });
    document.addEventListener('touchmove', lock, { passive: false });
    return () => {
      document.removeEventListener('wheel', lock);
      document.removeEventListener('touchmove', lock);
    };
  }, []);

  // Open submenu with a small delay to prevent accidental close
  const handleSubmenuEnter = useCallback((idx) => {
    if (submenuTimerRef.current) clearTimeout(submenuTimerRef.current);
    setActiveSubmenu(idx);
  }, []);

  const handleSubmenuLeave = useCallback(() => {
    submenuTimerRef.current = setTimeout(() => {
      setActiveSubmenu(null);
    }, 150);
  }, []);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-[#282828] rounded-lg shadow-2xl border border-white/10 py-1 min-w-[220px]"
      style={{ ...menuStyle, transition: 'opacity 75ms ease' }}
    >
      {items.map((item, idx) => {
        if (item.divider) {
          return <div key={idx} className="border-t border-white/10 my-1" />;
        }

        const Icon = item.icon;
        const hasSubmenu = item.submenu && item.submenu.length > 0;

        return (
          <div
            key={idx}
            className="relative"
            onMouseEnter={() => hasSubmenu ? handleSubmenuEnter(idx) : setActiveSubmenu(null)}
            onMouseLeave={() => hasSubmenu && handleSubmenuLeave()}
          >
            <button
              onClick={() => {
                if (!hasSubmenu && item.onClick) {
                  item.onClick();
                  onCloseRef.current();
                }
              }}
              className={`flex items-center gap-3 w-full px-3 py-2.5 text-sm hover:bg-white/10 transition-colors duration-100 text-left ${item.destructive ? 'text-red-400' : 'text-white/90'}`}
            >
              {Icon && <Icon className="w-4 h-4 text-spotify-text-subdued shrink-0" />}
              <span className="flex-1 truncate">{item.label}</span>
              {hasSubmenu && <span className="text-spotify-text-subdued text-xs ml-2">▸</span>}
            </button>

            {/* Sub-menu */}
            {hasSubmenu && activeSubmenu === idx && (
              <SubmenuPanel
                items={item.submenu}
                parentX={menuStyle.left}
                onClose={() => onCloseRef.current()}
                onMouseEnter={() => handleSubmenuEnter(idx)}
                onMouseLeave={() => handleSubmenuLeave()}
              />
            )}
          </div>
        );
      })}
    </div>,
    document.body
  );
}

function SubmenuPanel({ items, parentX, onClose, onMouseEnter, onMouseLeave }) {
  const ref = useRef(null);
  const [side, setSide] = useState('right');

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (parentX + 220 + rect.width > window.innerWidth - 8) {
      setSide('left');
    }
  }, [parentX]);

  const posStyle = side === 'right'
    ? { left: '100%', top: 0, marginLeft: '2px' }
    : { right: '100%', top: 0, marginRight: '2px' };

  return (
    <div
      ref={ref}
      className="absolute bg-[#282828] rounded-lg shadow-2xl border border-white/10 py-1 min-w-[180px] z-[201]"
      style={posStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {items.map((item, idx) => {
        const Icon = item.icon;
        return (
          <button
            key={idx}
            onClick={() => {
              item.onClick?.();
              onClose();
            }}
            className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-white/90 hover:bg-white/10 transition-colors duration-100 text-left"
          >
            {Icon && <Icon className="w-3.5 h-3.5 text-spotify-text-subdued shrink-0" />}
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
      {items.length === 0 && (
        <div className="px-3 py-2.5 text-sm text-spotify-text-subdued">No items</div>
      )}
    </div>
  );
}
