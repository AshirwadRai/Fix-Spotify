// Bridge between the React player and Android's media session.
//
// PlayerContext already drives navigator.mediaSession, which is enough in a real
// browser. Inside a bare WebView, Chromium does NOT forward that to Android's
// MediaSessionCompat, so the lock screen and the notification would show nothing
// and their buttons would do nothing.
//
// This module closes both directions:
//   JS  → native : report the current track + play state (AndroidPlayer.updatePlayback)
//   native → JS  : run transport commands from the notification (window.__androidTransport)
//
// In a desktop browser `window.AndroidPlayer` is undefined and every call here
// is a no-op, so `npm run dev:mobile` still works.

/** True when running inside the Android WebView (the @JavascriptInterface exists). */
export function isAndroid() {
  return typeof window !== 'undefined' && window.AndroidPlayer != null;
}

/**
 * Push the current playback state to the Android media session.
 * Called from MobileApp whenever the track, play/pause state, or position moves.
 */
export function reportPlayback({ track, isPlaying, duration, position, artwork }) {
  if (!isAndroid()) return;
  try {
    window.AndroidPlayer.updatePlayback(
      JSON.stringify({
        title: track?.title || '',
        artist: track?.artist || '',
        playing: !!isPlaying,
        // The media session works in milliseconds; the <audio> element in seconds.
        duration: Math.round((duration || 0) * 1000),
        position: Math.round((position || 0) * 1000),
        artwork: artwork || '',
      })
    );
  } catch {
    /* bridge unavailable — non-fatal, playback still works in-app */
  }
}

/**
 * Register the handlers Android invokes when the user hits a transport button
 * on the lock screen or in the notification shade.
 *
 * Returns a cleanup function.
 */
export function registerTransport({ play, pause, next, previous, seek }) {
  if (typeof window === 'undefined') return () => {};

  window.__androidTransport = (action) => {
    if (action?.startsWith('seek:')) {
      const ms = parseInt(action.slice(5), 10);
      if (!Number.isNaN(ms)) seek?.(ms / 1000);
      return;
    }
    switch (action) {
      case 'play':
        play?.();
        break;
      case 'pause':
        pause?.();
        break;
      case 'next':
        next?.();
        break;
      case 'previous':
        previous?.();
        break;
      default:
        break;
    }
  };

  return () => {
    delete window.__androidTransport;
  };
}
