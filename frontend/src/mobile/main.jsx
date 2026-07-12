import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MobileApp from './MobileApp';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initApiBase, setApiToken } from '../utils/config';
import { getApiToken } from './androidBridge';
import './mobile.css';

// The Flask backend serves this bundle AND /api/* from the same origin
// (http://127.0.0.1:8765), so initApiBase() takes its non-Tauri path, leaves the
// base relative, and every fetch in src/api.js just works — no CORS, no port
// discovery, no changes to config.js.
//
// Nothing here needs to wait for the backend: MainActivity does not load this
// page until /health answers, so Python is already serving by the time React
// mounts.

// Must happen BEFORE the first render: /api/* is token-gated (the loopback port
// is reachable by every other app on the phone), and a component that fetched
// during its first effect would otherwise get a 403.
setApiToken(getApiToken());

initApiBase().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ErrorBoundary>
        <MobileApp />
      </ErrorBoundary>
    </StrictMode>
  );
});
