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

import { useState, useEffect } from 'react';

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
 * The name of the device audio is currently playing OUT to — e.g. "WH-1000XM4".
 * Empty string when it's just the phone's own speaker (nothing worth showing),
 * or when not running on Android.
 *
 * Routing is an OS concern the WebView can't see, so this comes from
 * AudioManager on the native side.
 */
export function getAudioOutput() {
  if (!isAndroid() || typeof window.AndroidPlayer.getAudioOutput !== 'function') return '';
  try {
    return window.AndroidPlayer.getAudioOutput() || '';
  } catch {
    return '';
  }
}

/**
 * React hook: the current audio output device name, polled.
 *
 * Polling (rather than an event) because Android gives the WebView no callback
 * when routing changes; 4s is frequent enough to feel live after connecting
 * earbuds, and the call is a cheap in-process JNI hop.
 */
export function useAudioOutput(active = true) {
  const [device, setDevice] = useState('');

  useEffect(() => {
    if (!active || !isAndroid()) {
      setDevice('');
      return undefined;
    }
    const read = () => setDevice(getAudioOutput());
    read();
    const id = setInterval(read, 4000);
    return () => clearInterval(id);
  }, [active]);

  return device;
}

/** Installed app version ("1.1.0"), or '' outside Android. */
export function getAppVersion() {
  if (!isAndroid() || typeof window.AndroidPlayer.getVersion !== 'function') return '';
  try {
    return window.AndroidPlayer.getVersion() || '';
  } catch {
    return '';
  }
}

/**
 * In-app updates.
 *
 * Ask Android to look for a newer GitHub release. The check is async on the
 * native side, so the answer arrives via window.__androidUpdate rather than as a
 * return value.
 *
 *   onResult({ available, version, notes })
 *   onProgress(pct)   // 0..100 while downloading, -1 on failure
 *
 * Returns a cleanup function.
 */
export function registerUpdateHandlers({ onResult, onProgress }) {
  if (typeof window === 'undefined') return () => {};
  window.__androidUpdate = (info) => onResult?.(info || { available: false });
  window.__androidUpdateProgress = (pct) => onProgress?.(pct);
  return () => {
    delete window.__androidUpdate;
    delete window.__androidUpdateProgress;
  };
}

export function checkForUpdate() {
  if (!isAndroid() || typeof window.AndroidPlayer.checkForUpdate !== 'function') return false;
  try {
    window.AndroidPlayer.checkForUpdate();
    return true;
  } catch {
    return false;
  }
}

/** Download the pending update and open the system installer. */
export function installUpdate() {
  if (!isAndroid() || typeof window.AndroidPlayer.installUpdate !== 'function') return;
  try {
    window.AndroidPlayer.installUpdate();
  } catch {
    /* non-fatal */
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
