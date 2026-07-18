import { Sparkles, Check } from 'lucide-react';

/**
 * Shown once after an update — the first thing the user sees, listing what
 * changed in the version they just installed. Centred dialog, same shape as the
 * "Name your playlist" one, so it reads as part of the app rather than an ad.
 */
export function WhatsNewSheet({ entry, onClose }) {
  if (!entry) return null;
  return (
    <div
      className="sheet-scrim fixed inset-0 z-[80] flex items-center justify-center bg-black/75 px-7"
      onClick={onClose}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="dialog-pop w-full max-w-sm rounded-2xl bg-spotify-elevated-base p-6"
      >
        <div className="flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-spotify-essential-bright-accent/15">
            <Sparkles size={24} className="text-spotify-essential-bright-accent" />
          </span>
          <p className="mt-3 text-[13px] font-semibold uppercase tracking-widest text-spotify-text-subdued">
            What&apos;s new
          </p>
          <h2 className="mt-0.5 text-[20px] font-black tracking-tight">Version {entry.version}</h2>
        </div>

        <ul className="mt-5 space-y-3">
          {entry.highlights.map((line) => (
            <li key={line} className="flex items-start gap-3">
              <Check size={16} className="mt-0.5 shrink-0 text-spotify-essential-bright-accent" />
              <span className="text-[14px] leading-snug text-white/90">{line}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onClose}
          className="tap mt-6 w-full rounded-full bg-spotify-essential-bright-accent py-3 text-[15px] font-bold text-black"
        >
          Let&apos;s go
        </button>
      </div>
    </div>
  );
}
