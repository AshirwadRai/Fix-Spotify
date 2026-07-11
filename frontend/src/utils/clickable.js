/**
 * clickProps — make a plain `<div onClick>` card/tile/chip keyboard-operable the
 * way Spotify's cards are: the WHOLE card is one focus target (Tab lands on it,
 * the global :focus-visible ring shows on it), and Enter/Space activate it.
 *
 * The app has many clickable `<div>`s (Home cards, Browse tiles, recent-search
 * chips, artist/album cards, top-result card). Before this they were invisible
 * to the keyboard — Tab skipped the card and stopped on tiny/decorative inner
 * buttons instead, so no ring ever appeared on the card itself. Spreading
 * `{...clickProps(fn)}` fixes that in one line per site:
 *
 *   <div {...clickProps(() => onOpen(x))} className="…">…</div>
 *
 * Decorative inner buttons (the hover play-overlay) should get `tabIndex={-1}`
 * so the card stays the single tab stop. `label` sets an aria-label when the
 * card's visible text isn't descriptive on its own.
 *
 * ponytail: this is the plain "button" pattern, deliberately NOT a roving grid —
 * card grids are fine as linear tab stops (Spotify tabs through them too); the
 * roving grid is only worth it for long track LISTS (see useRovingTabIndex).
 */
export function clickProps(onClick, label) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick?.(e);
      }
    },
  };
}
