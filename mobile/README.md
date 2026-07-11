# Fix_Spotify — Android

An installable `.apk` that runs the **entire app on the phone** — UI *and* backend.
No server, no hosting, nothing to keep running.

---

## Why the backend runs on the phone

The obvious plan is to host `api/` in the cloud and ship a thin client. That
plan is broken:

| Source | Datacenter IP | Phone IP |
|---|---|---|
| **JioSaavn** (primary, 320kbps AAC) | geo-gated to India | ✅ works |
| **SoundCloud** | works | ✅ works |
| **YouTube** | ❌ bot-blocked instantly | ⚠️ needs a JS runtime |

A phone carries a **carrier/residential IP** — the same kind of IP the desktop
app used. Running the backend on-device sidesteps the blocking problem entirely,
and costs nothing to operate.

So Chaquopy embeds CPython in the APK, the Python backend serves
`http://127.0.0.1:8765`, and a WebView loads the React UI from that same origin.

```
┌──────────────────── APK (one process) ────────────────────┐
│                                                            │
│   WebView ──HTTP──►  Flask (Chaquopy CPython)              │
│   React UI           /api/*  +  the React bundle itself    │
│                          │                                 │
│                          ▼  phone's own residential IP     │
│              JioSaavn · SoundCloud · iTunes · lrclib       │
└────────────────────────────────────────────────────────────┘
```

Because Flask serves **both** the SPA and the API on one origin, `fetch('/api/…')`
stays relative and `frontend/src/utils/config.js` needed **zero changes**.

---

## What changed vs. the desktop app

**Reused unmodified:** every file in `components/` (all 9,124 lines), plus the
frontend's `api.js`, `config.js`, `store/`, and `utils/`.

| Desktop | Mobile | Why |
|---|---|---|
| FastAPI + uvicorn + pydantic | **Flask** | `pydantic-core` is a Rust extension — no Android wheel. Flask/Werkzeug are pure Python. All 30 routes keep identical request/response shapes. |
| rapidfuzz | **difflib** | C++ extension, no Android wheel. `components/` *already* falls back to difflib — verified to return byte-identical lyrics matches. |
| ffmpeg / ffprobe | *dropped* | No ffmpeg on Android. Only used to *display* bitrate; JioSaavn already tells us the bitrate it served. |
| **YouTube** | *dropped* | Needs Deno to solve its JS n-signature challenge; no Deno for Android. It was also the **lowest-quality** source (256k MP3 vs JioSaavn's 320k AAC). |
| Sidebar + window chrome | **Bottom tabs, mini-player, sheets** | A shrunk desktop layout is not a mobile app. |

> YouTube is disabled by a single hook in `mobile_server.py` that makes
> `UnifiedSearchService` refuse to build a YouTube client. That kills it
> *everywhere* (search, radio, artist pages) — so no unplayable YouTube result
> can ever reach the UI — **without editing `components/`**.

---

## Build the APK

**Android Studio is not required.** The JDK and the Android SDK are just ZIP
archives — extract them anywhere, no installer and no admin rights.

### Rebuild (toolchain already set up)

```
mobile\build-apk.bat
```

That builds the web bundle and the APK in one step, using the portable toolchain
in `Downloads\spotify\toolchain\`.

**Output:** `mobile/android/app/build/outputs/apk/release/app-release.apk`

Copy it to your phone and open it (allow "install from unknown sources").
First launch takes ~5–10s while CPython unpacks; after that it's instant.

> Signed with the debug key so it installs out of the box. Swap in your own
> keystore in `app/build.gradle` before distributing it to anyone else.

### Setting the toolchain up from scratch

Only needed on a fresh machine. Nothing here touches the system.

1. **JDK 17** — download the Temurin **`.zip`** (not the installer) and extract:
   <https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk>
2. **Android SDK** — extract `commandlinetools-win-*.zip` so that `sdkmanager.bat`
   ends up at `<sdk>/cmdline-tools/latest/bin/`, then:
   ```powershell
   $env:JAVA_HOME = "<path to jdk>"
   sdkmanager --sdk_root=<sdk> "platform-tools" "platforms;android-34" "build-tools;34.0.0"
   ```
   To accept licences without the interactive prompt, write the SHA1 hashes into
   `<sdk>/licenses/android-sdk-license` (this is what CI does).
3. **Point Gradle at it** — `mobile/android/local.properties`:
   ```properties
   sdk.dir=C:\\path\\to\\android-sdk
   ```
4. **Node 20+** for the React bundle.

Then set `JAVA_HOME` / `ANDROID_HOME` and run the two commands `build-apk.bat`
wraps:

```powershell
cd frontend;        npm install; npm run build:mobile
cd ..\mobile\android; .\gradlew.bat assembleRelease
```

---

## Iterating without a phone

The whole app runs on your PC — same code, same URLs:

```powershell
pip install flask requests mutagen yt-dlp
cd mobile\python
python mobile_server.py            # http://127.0.0.1:8765
```

Open that URL in a browser (use devtools' phone emulation). For hot-reload on
the UI, run `npm run dev:mobile` in `frontend/` instead and hit `:5174`.

---

## How the pieces fit

```
mobile/
├── python/
│   ├── mobile_server.py    Flask port of api/main.py — all 30 routes + the SPA
│   └── android_env.py      Android paths (HOME, downloads, cache) + logcat stdio
└── android/
    └── app/
        ├── build.gradle    Chaquopy config; syncs components/ + dist-mobile/ in
        └── src/main/java/…/
            ├── FixSpotifyApp.kt   starts the CPython interpreter
            ├── BackendService.kt  foreground service: runs Flask, owns MediaSession
            └── MainActivity.kt    the WebView

frontend/src/mobile/        the mobile UI (reuses PlayerContext, api.js, utils/)
├── MobileApp.jsx           tab shell, overlay/back-stack handling
├── androidBridge.js        JS ⇄ Android media session
├── components/             BottomNav · MiniPlayer · NowPlayingSheet · TrackActionSheet
└── views/                  Home · Search · Library · Downloads · CollectionSheet
```

### Two details worth knowing

**Background playback.** `MainActivity.onPause()` deliberately does *not* call
`webView.onPause()` — that call suspends all media in the page and is exactly
what would kill playback when you switch apps. The foreground service keeps the
process alive; we simply don't stop the page.

**Lock-screen controls.** `PlayerContext` already drives `navigator.mediaSession`,
but a bare WebView doesn't forward that to Android. `androidBridge.js` closes the
loop in both directions, so the notification and lock screen show the track and
their buttons actually work.

---

## Downloads

Files land in
`/storage/emulated/0/Android/data/com.xmrnoobx.fixspotify/files/Music/`.

That's the app-specific external directory: it needs **no storage permission on
any Android version**, is visible to file managers and over USB, and is removed
on uninstall. (Making downloads appear in the system Music app would need a
MediaStore insert — not done yet.)

---

## Verified working

Tested against the live services on the real code path (with `rapidfuzz` blocked
to simulate Android):

- Search → 5 JioSaavn results
- `/api/stream_url` → real 320kbps `saavncdn.com` URL
- `/api/proxy_stream` → **HTTP 206** + correct `Content-Range` (streaming *and* seeking)
- `/api/lyrics` → 46 synced lines from lrclib, identical with and without rapidfuzz
- `/api/home` → 4 populated rows
- YouTube → correctly reports `unavailable`
