import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MobileApp from './MobileApp';
import { initApiBase } from '../utils/config';
import './mobile.css';

// The Flask backend serves this bundle AND /api/* from the same origin
// (http://127.0.0.1:8765), so initApiBase() takes its non-Tauri path, leaves the
// base relative, and every fetch in src/api.js just works — no CORS, no port
// discovery, no changes to config.js.
//
// Nothing here needs to wait for the backend: MainActivity does not load this
// page until /health answers, so Python is already serving by the time React
// mounts.
initApiBase().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <MobileApp />
    </StrictMode>
  );
});
