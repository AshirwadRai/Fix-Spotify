import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { isTauri } from '../utils/config';

/**
 * Custom window title-bar controls (minimize / maximize-restore / close).
 * Renders only inside the Tauri desktop shell — invisible in the browser dev
 * server so the Vite preview stays clean.  Uses the Tauri v2 window JS API.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const [windowApi, setWindowApi] = useState(null);

  // Lazy-import the Tauri window API (it doesn't exist in the browser)
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    import('@tauri-apps/api/window').then(mod => {
      if (!cancelled) setWindowApi(mod);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Track maximize state so the icon switches between □ and ❐
  useEffect(() => {
    if (!windowApi) return;
    const win = windowApi.getCurrentWindow();
    // Initial check
    win.isMaximized().then(setMaximized).catch(() => {});
    // Listen for resize events to track maximize/unmaximize
    let unlisten;
    win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [windowApi]);

  if (!isTauri() || !windowApi) return null;

  const win = windowApi.getCurrentWindow();

  const handleMinimize = (e) => {
    e.stopPropagation();
    win.minimize();
  };
  const handleMaximize = (e) => {
    e.stopPropagation();
    win.toggleMaximize();
  };
  const handleClose = (e) => {
    e.stopPropagation();
    win.close();
  };

  return (
    <div className="fixed top-0 right-0 flex items-center window-controls z-[9999]">
      {/* Minimize */}
      <button
        onClick={handleMinimize}
        className="window-ctrl-btn window-ctrl-default"
        aria-label="Minimize"
        tabIndex={-1}
      >
        <Minus className="w-4 h-4" />
      </button>

      {/* Maximize / Restore */}
      <button
        onClick={handleMaximize}
        className="window-ctrl-btn window-ctrl-default"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        tabIndex={-1}
      >
        {maximized
          ? <Copy className="w-3.5 h-3.5 rotate-180" />
          : <Square className="w-3 h-3" />}
      </button>

      {/* Close */}
      <button
        onClick={handleClose}
        className="window-ctrl-btn window-ctrl-close"
        aria-label="Close"
        tabIndex={-1}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
