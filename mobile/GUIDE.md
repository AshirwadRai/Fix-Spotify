# Fix_Spotify — Developer & User Guide

Everything you need to understand, build, run, and ship both editions of the app.

- **Desktop** — Windows `.exe` (Tauri + Python sidecar). Unchanged by the mobile work.
- **Mobile** — Android `.apk` (WebView + Python-in-the-APK via Chaquopy).

---

## 1. How a user gets the app

Both installers come from the **[GitHub Releases](https://github.com/XMrNooBX/Fix-Spotify/releases)** page — nobody needs to build anything.

| You want… | Download | Runs on |
|---|---|---|
| Desktop | `Fix_Spotify_x.x.x_x64-setup.exe` | Windows 10/11 |
| Mobile | `Fix_Spotify_vx.x.x.apk` | Android 8+ |

A release is produced automatically when a maintainer pushes a version tag:

```bash
git tag v1.1.0
git push origin v1.1.0
```

That one tag fires two GitHub Actions workflows that publish into the **same** release:

- [`build-release.yml`](../.github/workflows/build-release.yml) → the Windows `.exe`
- [`build-android.yml`](../.github/workflows/build-android.yml) → the Android `.apk`

To get an APK **without** cutting a release (e.g. to test a branch): open the
**Actions** tab → *Build Android APK* → *Run workflow* → download it from the
run's **Artifacts**.

> The APK is self-signed (not Play Store), so phones show an "unknown developer"
> prompt on first install (**More info → Install anyway**). From v1.1.0 it uses a
> stable release key, which is what lets later versions install as a lossless
> *update* — see [§9](#9-updates-and-why-you-wont-lose-your-library).

---

## 2. The big picture

The two editions **share one React frontend and one Python backend**. Only the
shell around them differs.

```
                    ┌──────────────── shared code ────────────────┐
   DESKTOP          │  frontend/src/…  (React UI, api.js, stores)  │        MOBILE
   ───────          │  components/…    (JioSaavn, SoundCloud, …)   │        ──────
   Tauri window     │                                             │   Android WebView
   + Python .exe ───┤                                             ├─── + Python (Chaquopy)
   sidecar          └─────────────────────────────────────────────┘   in one process
```

Every feature is an HTTP call from the UI to a local Python server
(`127.0.0.1:8765`). That contract is identical on both platforms, which is why
the same `frontend/src/api.js` drives both.

### Why the backend runs on the phone (not a server)

JioSaavn geo-restricts to India and YouTube blocks datacenter IPs. Running the
backend **on the handset** means every request uses the user's own residential/
carrier IP — so there is nothing to host and nothing to get blocked.

### What differs on mobile

| | Desktop | Mobile | Why |
|---|---|---|---|
| Web server | FastAPI + uvicorn | **Flask** | `pydantic-core` is Rust; no Android wheel |
| Fuzzy match | rapidfuzz | **difflib** | rapidfuzz is C++; `components/` already falls back |
| Bitrate probe | ffprobe | source-advertised | no ffmpeg on Android |
| YouTube | supported | **disabled** | needs Deno (a JS runtime) — none on Android |
| UI shell | sidebar, windows | **bottom tabs, sheets** | touch, not mouse |

---

## 3. Repository map

```
Fix-Spotify/
├── api/                     # Desktop backend (FastAPI)  — main.py
├── components/              # SHARED backend logic (both editions import this)
│   ├── unified_search.py    #   multi-source search + merge
│   ├── jiosaavn_downloader.py, soundcloud_downloader.py, …
│   ├── metadata_enricher.py, profile.py, home.py, radio.py
│   └── …
├── frontend/
│   ├── src/
│   │   ├── api.js           # SHARED HTTP client → the Python backend
│   │   ├── store/           # SHARED PlayerContext, DownloadsContext
│   │   ├── utils/           # SHARED tracks/likes/collections/settings/…
│   │   ├── components/      # DESKTOP-only UI
│   │   └── mobile/          # MOBILE-only UI  (see §4)
│   ├── vite.config.js       # desktop build  → dist/
│   └── vite.config.mobile.js# mobile build   → dist-mobile/
│
├── mobile/
│   ├── python/
│   │   ├── mobile_server.py # Flask port of api/main.py (all 30 routes + SPA)
│   │   └── android_env.py   # Android paths / logcat bootstrap
│   ├── android/             # Gradle + Chaquopy + Kotlin project (see §5)
│   ├── build-apk.bat        # one-command local APK build
│   ├── get-crash-log.bat    # pull the on-device crash log over adb
│   ├── README.md            # mobile-specific build notes
│   └── GUIDE.md             # ← you are here
│
└── .github/workflows/       # build-release.yml (exe) · build-android.yml (apk)
```

**Rule of thumb:** anything under `components/`, `frontend/src/store/`,
`frontend/src/utils/`, or `frontend/src/api.js` is shared — a change there
affects **both** editions. UI is split: `frontend/src/components/` is desktop,
`frontend/src/mobile/` is mobile.

---

## 4. The mobile UI (`frontend/src/mobile/`)

Small, flat, and separated by concern. Each file does one thing.

```
mobile/
├── main.jsx              # entry — mounts MobileApp, resolves the API base
├── MobileApp.jsx         # the shell: tab state, overlay stack, hardware Back
├── mobile.css            # theme tokens + touch/safe-area helpers
├── androidBridge.js      # JS ⇄ Android media-session bridge (lock screen)
├── usePlayFrom.js        # play a track AND queue the rest of its list
├── usePlaylists.js       # playlist CRUD on localStorage
│
├── components/
│   ├── BottomNav.jsx         # 4 icon-only tabs
│   ├── MiniPlayer.jsx        # the pinned bar above the nav
│   ├── NowPlayingSheet.jsx   # full-screen player (art / lyrics / queue)
│   ├── TrackItem.jsx         # one row in any list  +  CardItem for rails
│   ├── TrackActionSheet.jsx  # the ⋮ bottom sheet (replaces right-click)
│   └── AddToPlaylistSheet.jsx# pick/create a playlist
│
└── views/
    ├── HomeTab.jsx           # discover rails
    ├── SearchTab.jsx         # search songs / artists / albums
    ├── LibraryTab.jsx        # liked · playlists · albums · offline
    ├── DownloadsTab.jsx      # queue + tap-to-play offline library
    ├── SettingsTab.jsx       # quality, crossfade, autoplay, … (opened via gear)
    ├── CollectionSheet.jsx   # REMOTE detail: album / artist / playlist (fetches)
    └── TrackListSheet.jsx    # LOCAL detail: liked / a playlist / offline
```

### Two conventions worth knowing

- **`playFrom(list, index)`** — always use this to start a song from a list. It
  plays the track *and* queues the rest, so "next" works. Calling
  `playTrack(track)` alone plays one song and then stops.
- **Overlay layering** — `CollectionSheet`, `TrackListSheet`, and `Settings`
  render **inside** `<main>` as `absolute inset-0`, so the mini-player and nav
  bar below them stay pinned and visible. Only `NowPlayingSheet` (the immersive
  player) covers the whole screen. Every overlay pushes a history entry so the
  hardware Back button peels them off one at a time.

---

## 5. The Android project (`mobile/android/`)

```
android/
├── app/
│   ├── build.gradle              # Chaquopy config; syncs components/ + dist-mobile/ in
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/…/fixspotify/
│       │   ├── FixSpotifyApp.kt      # starts the CPython interpreter
│       │   ├── BackendService.kt     # foreground service: runs Flask, owns MediaSession
│       │   └── MainActivity.kt       # the WebView
│       └── res/                      # icons, splash, theme
└── gradlew(.bat)                     # Gradle wrapper
```

- **Chaquopy** embeds CPython + the pip packages (`flask`, `requests`,
  `mutagen`, `yt-dlp`) into the APK.
- Gradle copies `components/` and `mobile/python/` into the build on every run
  (`syncPythonSources`), so the APK never drifts from the source you edit.
- **Background playback:** `MainActivity.onPause()` deliberately does *not* pause
  the WebView (that would stop the audio). The foreground service keeps the
  process alive.

---

## 6. Build & run

### Mobile — the whole app in a desktop browser (fastest inner loop)

No emulator needed. The mobile backend runs on your PC using local folders:

```bash
pip install flask requests mutagen yt-dlp
python mobile/python/mobile_server.py        # serves http://127.0.0.1:8765
```

Open that URL in a browser and use devtools' phone emulation. For UI hot-reload,
instead run:

```bash
cd frontend && npm install && npm run dev:mobile   # http://localhost:5174
```

### Mobile — the APK

```
mobile\build-apk.bat
```

builds the web bundle and the APK using the portable JDK + Android SDK in
`Downloads\spotify\toolchain\` (set up once — see `mobile/README.md`). Output:
`mobile/android/app/build/outputs/apk/release/app-release.apk`.

### Desktop — the `.exe`

Unchanged. See the root [`README.md`](../README.md): build the Python sidecar
with `build_backend.ps1`, then `cd frontend && npm run tauri build`.

---

## 7. Debugging the phone

If the app misbehaves on-device, capture the exact error over USB:

1. On the phone: **Settings → About → tap Build number ×7**, then
   **Developer options → enable USB debugging**. Plug in, tap **Allow**.
2. Run **`mobile\get-crash-log.bat`** — it clears the log, waits for you to
   reproduce, then prints the crash and saves the full log.

Python errors appear under the logcat tag **`FixSpotifyPy`**; the Kotlin service
logs under **`FixSpotifySvc`**.

---

## 8. FAQ

**Does the same APK work on every Android phone?**
Yes — it's built for `arm64-v8a` (every modern phone) and `x86_64` (emulators),
and the UI uses the system font and adapts to any screen via safe-area insets.
Minimum Android 8 (API 26).

**Is there an iOS build?**
Not yet. The React UI is portable, but the on-device Python (Chaquopy) is
Android-only. iOS would need a different embedding (e.g. a Rust rewrite of the
backend, or a hosted backend).

**Where do downloads go?**
`Android/data/com.xmrnoobx.fixspotify/files/Music/` — no storage permission
needed, visible over USB, removed on uninstall. Downloaded songs play with no
internet from the Downloads tab and the Library → Downloaded list.

---

## 9. Updates (and why you won't lose your library)

**The fear is real but the cause is uninstalling, not updating.**

Your playlists, liked songs, history and resume point live in the WebView's
`localStorage`, inside the app's private data directory. Android **keeps that
directory across an app update** — it only wipes it on *uninstall*. The same is
true on desktop: Tauri stores `localStorage` in the OS webview data dir, not in
the app bundle, so an installer upgrade leaves it alone.

Android only accepts an APK as an *update* when **both** the package name **and
the signing key** match the installed app. Earlier builds were debug-signed, so
each new one looked like a different app and had to be uninstalled — which is
exactly what wiped everything.

From **v1.1.0** the APK is signed with a stable release key, so every future
update installs straight over the top, losslessly.

> **One-time step:** v1.1.0 changes the signing key, so it cannot update the
> older debug-signed build. Uninstall once, install v1.1.0, and you'll never have
> to again.

### How users get updates now

| | How |
|---|---|
| **Mobile** | The app checks GitHub on open (**Settings → Updates**). If a newer release exists it offers **Download & install** — it fetches the APK and hands it to Android's installer. Data is preserved. |
| **Desktop** | Tauri's updater polls `latest.json` on the releases page, verifies its signature, and prompts to install. |

Both are driven by the same thing you already do:

```bash
git tag v1.2.0
git push origin v1.2.0
```

CI builds the `.exe` and the `.apk`, signs them, and publishes both (plus
`latest.json`) to one release. Every existing install then sees the update.

### Required secrets (set once, in GitHub → Settings → Secrets)

| Secret | What |
|---|---|
| `ANDROID_KEYSTORE_B64` | `base64 -w0 mobile/android/app/fixspotify-release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/fixspotify.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |

> **Back up both private keys.** Lose the Android keystore and you can never ship
> an update to existing installs again — every user would have to uninstall and
> lose their library. They are gitignored on purpose: anyone holding them can
> publish an "update" that users' devices will trust.
