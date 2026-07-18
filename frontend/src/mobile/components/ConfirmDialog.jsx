/**
 * In-app confirmation, replacing window.confirm — which on Android renders the
 * jarring "the page at 127.0.0.1 says…" system dialog that breaks the app's look.
 *
 * Controlled: render it when you have something to confirm, pass onConfirm /
 * onCancel. `danger` tints the confirm button for destructive actions (delete),
 * left neutral for reversible ones (reset).
 */
export function ConfirmDialog({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  danger = false, onConfirm, onCancel,
}) {
  return (
    <div
      className="sheet-scrim fixed inset-0 z-[85] flex items-center justify-center bg-black/75 px-8"
      onClick={onCancel}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="dialog-pop w-full max-w-sm rounded-2xl bg-spotify-elevated-base p-6"
      >
        <p className="text-center text-[17px] font-bold text-white">{title}</p>
        {message && (
          <p className="mt-2 text-center text-[13.5px] leading-snug text-spotify-text-subdued">
            {message}
          </p>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="tap px-5 py-2.5 rounded-full text-[14px] font-semibold text-white/70"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`tap px-6 py-2.5 rounded-full text-[14px] font-bold ${
              danger
                ? 'bg-spotify-essential-negative text-white'
                : 'bg-spotify-essential-bright-accent text-black'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
