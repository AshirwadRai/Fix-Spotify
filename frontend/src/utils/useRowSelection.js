import { useState, useEffect } from 'react';

/**
 * Spotify-style row selection: one "selected" (clicked) row per list view.
 *
 * The view calls the returned setter on row click; clicking anywhere that is
 * NOT a track row clears the selection (matches Spotify — the grey highlight
 * drops when you click empty space or another area, and a still-playing row
 * falls back to its equalizer/now-playing state). Rows MUST carry the
 * `data-row-selectable` attribute so the outside-click detector can tell a row
 * click from an empty-space click.
 *
 * Returns [selIdx, setSelIdx] exactly like useState.
 */
export function useRowSelection() {
  const [selIdx, setSelIdx] = useState(null);
  useEffect(() => {
    if (selIdx === null) return undefined;
    const clear = (e) => {
      if (!e.target.closest('[data-row-selectable]')) setSelIdx(null);
    };
    document.addEventListener('mousedown', clear);
    return () => document.removeEventListener('mousedown', clear);
  }, [selIdx]);
  return [selIdx, setSelIdx];
}
