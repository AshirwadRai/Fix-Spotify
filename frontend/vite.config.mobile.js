import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { renameSync, existsSync } from 'fs'

// Rollup names the emitted HTML after its input, so we'd get
// dist-mobile/index.mobile.html. Flask serves "index.html" as the SPA root, so
// rename it once the bundle is written.
function renameHtmlEntry() {
  return {
    name: 'rename-mobile-html',
    closeBundle() {
      const from = resolve(__dirname, 'dist-mobile/index.mobile.html')
      const to = resolve(__dirname, 'dist-mobile/index.html')
      if (existsSync(from)) renameSync(from, to)
    },
  }
}

// In DEV, Vite serves index.html (the DESKTOP entry) at '/'. The on-device
// debug WebView needs the MOBILE entry, so rewrite '/' to index.mobile.html.
// Without this the phone loads the desktop app, which never sets the Android
// API token and so gets 403 FORBIDDEN on every /api call.
function serveMobileEntry() {
  return {
    name: 'serve-mobile-entry',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/' || req.url === '/index.html') req.url = '/index.mobile.html'
        next()
      })
    },
  }
}

// Build config for the Android app.
//
// Output goes to dist-mobile/, which mobile/android/app/build.gradle copies into
// the APK's assets. The Flask backend then serves that folder as the SPA root,
// so the page and the API share an origin (see mobile/python/mobile_server.py).
export default defineConfig({
  plugins: [react(), tailwindcss(), renameHtmlEntry(), serveMobileEntry()],

  // Assets are served from the server root (http://127.0.0.1:8765/), so absolute
  // '/assets/...' paths are correct.
  base: '/',

  build: {
    outDir: 'dist-mobile',
    emptyOutDir: true,
    // The APK is installed once and read from local storage — a couple of
    // slightly larger files beat dozens of round trips through the WebView.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: resolve(__dirname, 'index.mobile.html'),
      output: {
        // Vite would otherwise name the entry after the html file
        // ("index.mobile"). Keep it boring.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },

  server: {
    port: 5174,
    // Bind all interfaces so the on-device WebView (via `adb reverse tcp:5174`)
    // can reach the dev server, not just a desktop browser on localhost.
    host: true,
    proxy: {
      // Two consumers, one proxy:
      //  · `npm run dev:mobile` in a desktop browser against a locally-run
      //    mobile backend (`python mobile_server.py --port 8766`), and
      //  · the DEBUG Android build hot-reloading (MainActivity loads this dev
      //    server; /api and /health are forwarded to the PHONE's Flask via
      //    `adb forward tcp:8766 tcp:8766`).
      // ponytail: the debug APK on-device right now still binds 8765 (built before
      // the 8766 port-separation fix landed in BackendService.kt). Bump this to
      // 8766 the next time a fresh debug APK is installed, to match its new port.
      '/api': { target: 'http://127.0.0.1:8765', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:8765', changeOrigin: true },
    },
  },
})
