// Shared hook: average color of an image as an "r, g, b" string (matching the
// app's --dynamic-color convention used in App.jsx), or null until it resolves.
//
// Used to tint page headers from their OWN art (artist / album heroes), reusing
// the `fast-average-color` dependency PlayerBar / NowPlayingPanel already use —
// no new dep. ponytail: average color (not dominant/vibrant) is what the rest of
// the app already uses; node-vibrant would be a heavier upgrade if we ever want
// punchier hero colors.

import { useState, useEffect } from 'react';
import { FastAverageColor } from 'fast-average-color';

export function useDominantColor(imageUrl) {
  const [rgb, setRgb] = useState(null);

  useEffect(() => {
    if (!imageUrl) { setRgb(null); return; }
    let cancelled = false;
    const fac = new FastAverageColor();
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageUrl;
    img.onload = () => {
      try {
        const c = fac.getColor(img);
        if (!cancelled) setRgb(c.value.slice(0, 3).join(', '));
      } catch { if (!cancelled) setRgb(null); }
    };
    img.onerror = () => { if (!cancelled) setRgb(null); };
    return () => { cancelled = true; try { fac.destroy(); } catch { /* ignore */ } };
  }, [imageUrl]);

  return rgb;
}
