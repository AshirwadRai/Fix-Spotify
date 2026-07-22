// Module-level store for the app-update flow, so a download in progress survives
// the Settings screen unmounting.
//
// The bug this fixes: UpdateSection used to hold `state`/`pct` in local useState
// and register onProgress in its own effect. Scrolling away to Home/playlist
// unmounted it, tore down the progress handler, and lost the download — the
// native APK fetch kept running on its daemon thread, orphaned, so the update
// appeared to "fail" the moment you navigated.
//
// Here the native callbacks are registered ONCE, at module load, and never
// cleaned up. Progress flows into this store no matter which component (if any)
// is on screen; the UI just subscribes.

import { useSyncExternalStore } from 'react';
import { registerUpdateHandlers, checkForUpdate, installUpdate, isAndroid } from './androidBridge';

// phase: idle | checking | current | found | downloading | failed
let state = { phase: 'idle', info: null, pct: 0 };
const listeners = new Set();

function emit() {
  state = { ...state }; // new identity so useSyncExternalStore re-renders
  listeners.forEach((l) => l());
}

let registered = false;
function ensureRegistered() {
  if (registered || !isAndroid()) return;
  registered = true;
  // Never cleaned up — that permanence is the whole point.
  registerUpdateHandlers({
    onResult: (res) => {
      state = { ...state, info: res, phase: res?.available ? 'found' : 'current' };
      emit();
    },
    onProgress: (p) => {
      if (p < 0) { state = { ...state, phase: 'failed' }; emit(); return; }
      state = { ...state, pct: p, phase: 'downloading' };
      emit();
    },
  });
}

/** Kick a silent check. Safe to call repeatedly (launch + opening Settings). */
export function checkUpdate() {
  ensureRegistered();
  if (!isAndroid()) return;
  if (state.phase === 'downloading') return; // don't disturb an in-flight install
  state = { ...state, phase: 'checking' };
  emit();
  checkForUpdate();
}

/** Begin downloading + installing. Progress lands in the store regardless of
 *  what's on screen, so navigating away no longer breaks it. */
export function startUpdateInstall() {
  ensureRegistered();
  state = { ...state, phase: 'downloading', pct: 0 };
  emit();
  installUpdate();
}

function subscribe(l) { ensureRegistered(); listeners.add(l); return () => listeners.delete(l); }
function snapshot() { return state; }

/** Live view of the update flow. */
export function useUpdate() {
  return useSyncExternalStore(subscribe, snapshot);
}
