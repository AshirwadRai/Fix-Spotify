import { useState, useEffect, useRef } from 'react';

/**
 * Listens for 'app-toast' events and shows notifications ONE AT A TIME, just
 * above the player bar. Multiple actions in quick succession queue up and play
 * through in order instead of piling on top of each other.
 */
export function Toaster() {
  const [current, setCurrent] = useState(null);   // { id, message } or null
  const queueRef = useRef([]);
  const idRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    // Pull the next message and show it; when it expires, show the one after.
    const pump = () => {
      const next = queueRef.current.shift();
      if (!next) { busyRef.current = false; return; }
      busyRef.current = true;
      setCurrent(next);
      setTimeout(() => { setCurrent(null); setTimeout(pump, 180); }, 2200);
    };

    const handler = (e) => {
      queueRef.current.push({ id: ++idRef.current, message: e.detail });
      if (!busyRef.current) pump();
    };
    window.addEventListener('app-toast', handler);
    return () => window.removeEventListener('app-toast', handler);
  }, []);

  if (!current) return null;

  return (
    <div className="fixed bottom-28 inset-x-4 z-[9999] pointer-events-none">
      {/* Spotify's own toast recipe: a white bar with black text. On an
          otherwise-dark UI it reads instantly without needing an icon. */}
      <div
        key={current.id}
        className="flex items-center justify-center rounded-lg bg-[#f6f6f6] px-4 py-3 text-[13px] font-semibold text-black shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
        style={{ animation: 'toastIn 220ms cubic-bezier(0.22,0.61,0.36,1)' }}
      >
        {current.message}
      </div>
    </div>
  );
}
