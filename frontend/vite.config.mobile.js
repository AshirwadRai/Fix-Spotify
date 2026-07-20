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

// Build config for the Android app.
//
// Output goes to dist-mobile/, which mobile/android/app/build.gradle copies into
// the APK's assets. The Flask backend then serves that folder as the SPA root,
// so the page and the API share an origin (see mobile/python/mobile_server.py).
export default defineConfig({
  plugins: [react(), tailwindcss(), renameHtmlEntry()],

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
    proxy: {
      // `npm run dev:mobile` in a desktop browser, against the mobile backend
      // running via `python mobile/python/mobile_server.py`.
      '/api': { target: 'http://127.0.0.1:8765', changeOrigin: true },
    },
  },
})
