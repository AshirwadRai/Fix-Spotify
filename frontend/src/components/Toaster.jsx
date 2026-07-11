import { useState, useEffect, useRef } from 'react';

/**
 * Listens for 'app-toast' events and shows transient notifications at the
 * bottom-center of the screen. Styled to match Spotify's minimal dark toasts.
 */
export function Toaster() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  useEffect(() => {
    const handler = (e) => {
      const id = ++idRef.current;
      setToasts(prev => [...prev, { id, message: e.detail }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 3000);
    };
    window.addEventListener('app-toast', handler);
    return () => window.removeEventListener('app-toast', handler);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className="bg-[#2e2e2e] text-white text-sm px-4 py-2.5 rounded shadow-lg backdrop-blur-sm border border-white/[0.06]"
          style={{ animation: 'toastIn 200ms ease-out' }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
