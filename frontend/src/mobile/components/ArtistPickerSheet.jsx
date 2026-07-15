import { User } from 'lucide-react';

/**
 * ArtistPickerSheet — asks WHICH artist, when a song credits several.
 *
 * Tapping "Diljit Dosanjh, Sia" used to query the artist API for a performer
 * literally named "Diljit Dosanjh, Sia", which of course doesn't exist. A credit
 * with more than one name isn't a destination — it's a choice, so we ask.
 *
 * A single-artist credit never reaches here; openArtist() opens it directly.
 */
export function ArtistPickerSheet({ artists = [], onPick, onClose }) {
  if (!artists.length) return null;

  return (
    <div
      className="sheet-scrim fixed inset-0 z-[60] flex flex-col justify-end bg-black/60"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="sheet-panel bg-spotify-elevated-base rounded-t-2xl pb-safe"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Choose an artist"
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full bg-white/25" />
        </div>

        <p className="px-5 pt-2 pb-3 text-xs font-semibold uppercase tracking-wider text-spotify-text-subdued">
          Choose an artist
        </p>

        <ul className="pb-2">
          {artists.map((name) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => onPick(name)}
                className="tap flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors duration-fast active:bg-white/10"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-spotify-elevated-highlight">
                  <User size={20} className="text-spotify-text-subdued" />
                </span>
                <span className="truncate text-[15px] font-medium text-white">{name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
