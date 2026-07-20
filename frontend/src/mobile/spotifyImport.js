// A module-level store for the active Spotify import, so progress survives the
// import screen being closed. The actual matching runs on the backend as a job
// keyed by URL (it keeps going regardless of the app); this just polls it and
// holds the latest snapshot, which is what lets the user leave Search, come back,
// and see exact progress instead of a restart.

import { useSyncExternalStore } from 'react';
import { api } from '../api';

function empty() {
  return { url: null, name: '', image: '', total: 0, done: 0,
           tracks: [], missing: [], finished: false, error: null };
}

let state = empty();
const listeners = new Set();
let timer = null;

function emit() {
  // New object identity each tick so useSyncExternalStore re-renders.
  state = { ...state };
  listeners.forEach((l) => l());
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

/** Start (or resume) importing a URL. Idempotent for the same URL — a repeated
 *  call while it's already running does NOT restart the backend job. */
export function startImport(url) {
  if (!url) return;
  if (state.url === url && !state.error) return;   // already running/done for this url
  stop();
  state = { ...empty(), url };
  emit();

  const poll = async () => {
    const res = await api.importSpotifyStatus(url);
    if (state.url !== url) return;                  // superseded by a newer import
    state = { url, ...res };
    listeners.forEach((l) => l());
    if (res.finished || res.error) stop();
  };
  poll();
  timer = setInterval(poll, 800);
}

function subscribe(l) { listeners.add(l); return () => listeners.delete(l); }
function snapshot() { return state; }

/** Live view of the current import. */
export function useSpotifyImport() {
  return useSyncExternalStore(subscribe, snapshot);
}
