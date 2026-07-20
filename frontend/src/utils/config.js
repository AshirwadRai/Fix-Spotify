// Runtime API base resolution.
//
// Dev (browser):  '' so relative '/api/...' works through the Vite proxy.
// Tauri EXE:      'http://127.0.0.1:<backendPort>' — there is no proxy in the
//                 packaged app, and the Python backend runs as a sidecar on its
//                 own port, so every fetch AND the <audio> element must target
//                 it by absolute URL.

let _apiBase = '';        // default: relative (dev / Vite proxy)
let _initPromise = null;

export function isTauri() {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ != null;
}

/** Current absolute API base, e.g. 'http://127.0.0.1:8765', or '' in dev. */
export function getApiBase() {
  return _apiBase;
}

// Android only. The on-device server gates /api/* on a per-launch token, because
// its loopback port is reachable by every other app on the phone. Empty on
// desktop and in dev, where the guard is off.
let _apiToken = '';

export function setApiToken(token) {
  _apiToken = token || '';
}

/**
 * Build a full API URL. apiUrl('/lyrics?x=1') -> `${base}/api/lyrics?x=1`.
 *
 * The token goes in the QUERY STRING, not a header, because this same function
 * builds <audio src="/api/proxy_stream?..."> — and an audio element cannot send
 * headers. Appending it here, in the one place every URL is built, is what stops
 * a call site from forgetting it and getting a silent 403.
 */
export function apiUrl(path) {
  const url = `${_apiBase}/api${path}`;
  if (!_apiToken) return url;
  return `${url}${url.includes('?') ? '&' : '?'}_t=${encodeURIComponent(_apiToken)}`;
}

/**
 * Poll the backend /health endpoint until it responds (or we give up).
 * The Rust side does its own wait_for_ready, but the JS render can still
 * outrace it because the setup() spawn is async. This ensures the React
 * tree only mounts once the backend is truly serving requests, so the
 * HomeView's first fetch(apiUrl('/home')) doesn't silently fail.
 */
async function _waitForBackend() {
  if (!_apiBase) return; // dev mode — Vite proxy handles it
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${_apiBase}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch { /* not ready yet */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  // Give up after ~15s — let the app render anyway (degraded but not stuck)
}

/**
 * Resolve the API base once (cached). In Tauri, asks the Rust side for the
 * backend port; falls back to the known sidecar port (8765). Then waits for
 * the backend to be healthy before resolving. Never throws.
 */
export function initApiBase() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (!isTauri()) { _apiBase = ''; return _apiBase; }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const status = await invoke('get_backend_status');
      if (status && status.port) {
        _apiBase = `http://127.0.0.1:${status.port}`;
      } else {
        _apiBase = 'http://127.0.0.1:8765';
      }
    } catch {
      _apiBase = 'http://127.0.0.1:8765'; // matches backend.rs sidecar port
    }
    // Wait for the backend to actually be healthy before letting the app render
    await _waitForBackend();
    return _apiBase;
  })();
  return _initPromise;
}
