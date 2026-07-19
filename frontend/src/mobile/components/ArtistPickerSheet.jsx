import { useState, useEffect } from 'react';
import { User } from 'lucide-react';
import { api } from '../../api';

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
  // Real artist photos, fetched only when the picker opens (never in a hot
  // path — this sheet appears at most on a multi-artist tap). One lightweight
  // lookup per name; the generic icon stays until (and if) an image arrives, so
  // a miss or a slow network costs nothing but the fallback.
  const [images, setImages] = useState({});
  useEffect(() => {
    if (!artists.length) return undefined;
    let cancelled = false;
    Promise.all(
      artists.map(async (name) => {
        const hits = await api.searchArtists(name);
        // Best match = the first hit whose name matches; else the top hit.
        const lc = name.toLowerCase();
        const hit = hits.find((h) => (h.name || '').toLowerCase() === lc) || hits[0];
        return [name, hit?.image || ''];
      })
    ).then((pairs) => {
      if (!cancelled) setImages(Object.fromEntries(pairs.filter(([, img]) => img)));
    });
    return () => { cancelled = true; };
  }, [artists]);

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
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-9 h-1 rounded-full bg-white/25" />
        </div>

        <ul className="pb-2 pt-1">
          {artists.map((name) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => onPick(name)}
                className="tap flex w-full items-center gap-4 px-5 py-3 text-left transition-colors duration-fast active:bg-white/10"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-spotify-elevated-highlight">
                  {images[name] ? (
                    <img src={images[name]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <User size={20} className="text-spotify-text-subdued" />
                  )}
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
