import { useCallback } from 'react';

/**
 * Keyboard navigation for a TrackRow list.
 *
 * Model (chosen to match what users expect, after roving "one tab stop per list"
 * proved confusing — Tab landed on the first row then jumped straight to the
 * browser UI): **every row is a Tab stop**, so Tab/Shift+Tab walk track → track
 * through the whole list. The in-row controls (title, artists, like, ⋯) are
 * `[data-cell]` + `tabIndex={-1}`, so Tab NEVER detours through them — it moves
 * strictly between tracks. Inside the focused row, **ArrowLeft/Right** step
 * through those controls (Spotify's grid feel). **ArrowUp/Down** also move rows
 * and **Home/End** jump to the ends, as a bonus over Tab.
 *
 * Implemented at the CONTAINER via one delegated keydown on the list wrapper
 * (it queries its own `.track-row` children) — no per-row refs. TrackRow only
 * needs `tabIndex={0}` from `tabIndex()` and the controls' `[data-cell]`.
 *
 * Usage (args are ignored now — kept so call sites don't churn):
 *   const roving = useRovingTabIndex();
 *   <div className="space-y-0.5" {...roving.listProps}>
 *     {tracks.map((t, i) => <TrackRow … tabIndex={roving.tabIndex()} />)}
 *
 * ponytail: pure-UI hook → its check is `npm run build` + a manual keyboard pass.
 * Ceiling: a very long list becomes many Tab stops (the user WANTS to tab tracks,
 * so that's intended); the DOM-query delegation assumes rows carry `.track-row`.
 */
export function useRovingTabIndex() {
  const onKeyDown = useCallback((e) => {
    const key = e.key;
    // Horizontal — step among the focused row's in-row controls (title, artists,
    // like, ⋯). They carry `[data-cell]` + tabIndex=-1, so they're reachable
    // ONLY here, never via linear Tab.
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      const row = document.activeElement?.closest('.track-row');
      if (!row || !e.currentTarget.contains(row)) return;
      const cells = [...row.querySelectorAll('[data-cell]')];
      if (!cells.length) return;
      const at = cells.indexOf(document.activeElement);
      e.preventDefault();
      e.stopPropagation(); // don't let the global Arrow Left/Right (seek) also fire
      if (key === 'ArrowRight') {
        cells[at < 0 ? 0 : Math.min(cells.length - 1, at + 1)].focus(); // row → first cell, else next
      } else if (at <= 0) {
        row.focus(); // first cell (or already the row) → back to the row
      } else {
        cells[at - 1].focus();
      }
      return;
    }
    // Vertical + jumps — move between rows; focus lands on the ROW itself.
    const dir = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
    const jump = key === 'Home' ? 'home' : key === 'End' ? 'end' : null;
    if (!dir && !jump) return; // ignore Enter/Space/Tab/etc.
    const rows = [...e.currentTarget.querySelectorAll('.track-row')];
    if (!rows.length) return;
    const cur = rows.indexOf(document.activeElement?.closest('.track-row'));
    let next;
    if (jump === 'home') next = 0;
    else if (jump === 'end') next = rows.length - 1;
    else next = Math.max(0, Math.min(rows.length - 1, (cur < 0 ? 0 : cur) + dir));
    e.preventDefault();
    // stopPropagation so the global player shortcut (window keydown: Arrow
    // Up/Down = volume) doesn't ALSO fire while we're moving row focus.
    e.stopPropagation();
    rows[next]?.focus();
  }, []);

  return {
    listProps: { onKeyDown },
    tabIndex: () => 0, // every row is a Tab stop
  };
}
