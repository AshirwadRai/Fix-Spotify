<div align="center">

# Fix_Spotify

**A multi-source music search, streaming and download client for Windows and Android**

[![Release](https://img.shields.io/github/v/release/AshirwadRai/Fix-Spotify?style=for-the-badge&color=1DB954&label=Download)](https://github.com/AshirwadRai/Fix-Spotify/releases/latest)
[![User Manual](https://img.shields.io/badge/user-manual-darkred?style=for-the-badge)](docs/USER_GUIDE.md)
[![License](https://img.shields.io/github/license/AshirwadRai/Fix-Spotify?style=for-the-badge&color=blue)](LICENSE)
[![Build](https://img.shields.io/github/actions/workflow/status/AshirwadRai/Fix-Spotify/build-release.yml?style=for-the-badge&label=Build)](https://github.com/AshirwadRai/Fix-Spotify/actions)

Search, stream and download music from **JioSaavn**, **SoundCloud** and **YouTube**
from a single application.

</div>

---

> [!IMPORTANT]
> **This project is for educational and personal use only.** It is intended as a learning resource for building cross-platform applications with Tauri, React, Android and Python. Please respect the terms of service of the music platforms and the rights of content creators. The developers are not responsible for any misuse of this software.

---

## Overview

Fix_Spotify queries several public music sources in parallel, merges the results into a single
de-duplicated list, and lets you stream or download any track. Everything runs on the user's own
device: there is no server component, no account and no telemetry.

Two clients share the same Python backend and the same React codebase:

|                    | Windows                          | Android                                   |
| ------------------ | -------------------------------- | ----------------------------------------- |
| Shell              | Tauri v2 (Rust)                  | WebView (Kotlin)                          |
| Backend            | Python sidecar process (FastAPI) | Python in-process (Flask, via Chaquopy)   |
| YouTube extraction | yt-dlp + Deno                    | NewPipeExtractor                          |
| Transcoding        | FFmpeg (bundled)                 | None — the source container is kept as-is |
| Media controls     | OS media session                 | `MediaSessionCompat` + notification       |

Multi-source search with cross-source fallback, radio and autoplay, an eight-band equalizer,
crossfade, offline downloads with embedded metadata, synced lyrics, and lock-screen controls.

> **Installing or using the app? → [User Guide](docs/USER_GUIDE.md)**
> Downloads, features and troubleshooting are covered there. The rest of this document is for
> people working on the code.

---

## Sources

| Source         | Availability | Notes                                         |
| -------------- | ------------ | --------------------------------------------- |
| **JioSaavn**   | Always on    | Primary catalogue. Streams at up to 320 kbps. |
| **SoundCloud** | Always on    | Remixes, DJ sets and independent uploads.     |
| **YouTube**    | Opt-in       | Enable under *Settings → Sources*.            |

### YouTube on Android

YouTube gates its stream URLs behind a JavaScript signature and throttling challenge. yt-dlp solves
this with an external JavaScript runtime — Deno on the desktop — and Android has none.

The Android build therefore uses **NewPipeExtractor**, which performs the same deobfuscation
natively with a bundled Rhino engine: no Python, no cookies, no sign-in. Enabling the source runs a
real on-device self-test — it resolves an actual audio stream, which is the step that requires the
challenge to be solved — and only switches on if that succeeds, so the app never claims YouTube
works on a device where it does not.

Both this project and NewPipeExtractor are GPLv3, so linking it is licence-compatible.

---

## Architecture

```
Fix-Spotify/
├── api/main.py          # Desktop backend — FastAPI
│
├── components/          # Shared backend; used by BOTH clients
│                        #   unified_search · source_merger · fuzzy_matcher
│                        #   download_manager · metadata_enricher · radio
│                        #   jiosaavn / soundcloud / youtube clients
│                        #   itunes · musicbrainz · home · profile
│
├── frontend/
│   ├── src/             # Desktop React app
│   ├── src/mobile/      # Mobile React app (separate entry + bundle)
│   ├── src/store/       # Player and downloads state (shared)
│   ├── src/utils/       # Shared utilities — eq, queue, pins, tracks…
│   └── src-tauri/       # Rust shell — sidecar, window, IPC
│
├── mobile/
│   ├── python/          # Android backend — Flask, NewPipe bridge, env
│   └── android/         # Gradle project
│                        #   MainActivity · BackendService · YouTubeNP · Updater
│
└── .github/workflows/   # build-release.yml (Windows) · build-android.yml (APK)
```

`components/` and `mobile/python/` are the single source of truth for the backend. Gradle copies
them into the Android project on every build (`syncPythonSources`), so the APK cannot drift from the
code in the repository. The copies under `mobile/android/app/src/main/python/` are build output and
are not committed.

### Desktop

```
┌──────────────┐       HTTP        ┌──────────────────┐
│ Tauri shell  │ ◄───────────────► │  Python sidecar  │
│ Rust + React │  127.0.0.1:8765   │  FastAPI         │
└──────┬───────┘                   └────────┬─────────┘
       │ WebView2                           │ HTTPS
       ▼                                    ▼
    the user                  JioSaavn / SoundCloud / YouTube
                              iTunes / MusicBrainz / lrclib
```

Tauri renders the React frontend in a native WebView and spawns the Python backend as a sidecar
process. FFmpeg, ffprobe and Deno are bundled as Tauri resources.

### Android

```
┌───────────────────────────────────────────────┐
│ MainActivity — WebView                        │
│   React (dist-mobile) + <audio>               │
│         │ JS bridge           ▲ transport     │
│         ▼                     │               │
│ BackendService (foreground service)           │
│   ├── Flask (Chaquopy)   127.0.0.1:8765       │
│   ├── MediaSessionCompat + notification       │
│   └── ACTION_AUDIO_BECOMING_NOISY             │
│                                               │
│ YouTubeNP.kt ──► NewPipeExtractor             │
└───────────────────────────────────────────────┘
```

The page and the API share an origin (`127.0.0.1:8765`), which is what lets the `<audio>` element
issue Range requests against the stream proxy and seek correctly. Because that loopback port is
reachable by every other app on the device, the API is guarded by a per-launch token handed to the
page over the JavaScript bridge — it never appears in the served HTML.

The backend runs inside a foreground service of type `mediaPlayback`. Without one, Android freezes
the process as soon as it is backgrounded and the music stops.

The service deliberately does **not** request audio focus. Chromium already holds focus for the
`<audio>` element, and focus is tracked per listener rather than per app — so a second request from
this process evicts our own, and Chromium responds to the loss by pausing playback.

---

## Building from source

| Tool        | Version | Needed for |
| ----------- | ------- | ---------- |
| Python      | 3.11+   | both       |
| Node.js     | 20+     | both       |
| Rust        | 1.88+   | Windows    |
| JDK         | 17      | Android    |
| Android SDK | API 34  | Android    |

### Windows

```powershell
git clone https://github.com/AshirwadRai/Fix-Spotify.git
cd Fix-Spotify

# Python environment
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r api/requirements.txt pyinstaller

# Vendor binaries (FFmpeg + Deno) — runtime dependencies bundled into the app
New-Item -ItemType Directory -Force -Path "vendor/bin" | Out-Null

Invoke-WebRequest "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip" -OutFile ffmpeg.zip
Expand-Archive ffmpeg.zip -DestinationPath ffmpeg-tmp -Force
Copy-Item ffmpeg-tmp/*/bin/* vendor/bin/ -Force
Remove-Item ffmpeg.zip, ffmpeg-tmp -Recurse -Force

Invoke-WebRequest "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip" -OutFile deno.zip
Expand-Archive deno.zip -DestinationPath vendor/bin -Force
Remove-Item deno.zip -Force

# Backend sidecar
.\build_backend.ps1

# Frontend
cd frontend
npm install
npm run tauri dev        # development, hot-reload
npm run tauri build      # installer -> src-tauri/target/release/bundle/nsis/
```

### Android

```bash
# 1. Build the mobile web bundle FIRST — Gradle copies it into the APK's assets
cd frontend
npm install
npm run build:mobile

# 2. Build the APK
cd ../mobile/android
./gradlew assembleRelease
# Output: app/build/outputs/apk/release/
```

The Gradle build fails fast with an explanatory message if `frontend/dist-mobile` is missing.

**Signing.** Android identifies an app by application ID *plus signing key*. An APK signed with a
different key cannot update an existing install — the user would have to uninstall, wiping their
data. Release builds therefore use a stable, long-lived key: locally from
`mobile/android/app/fixspotify-release.jks` and `keystore.properties` (both gitignored), and in CI
from the `ANDROID_KEYSTORE_B64` and `ANDROID_KEYSTORE_PASSWORD` secrets. Without either, the build
falls back to the debug key so that a fresh clone still compiles.

**Versioning.** `versionName` is never hand-edited. CI passes the release tag to Gradle as
`-PappVersionName`, and `versionCode` is derived from it (`major × 10000 + minor × 100 + patch`).
This is what stops the installed version and the advertised version from disagreeing.

---

## Releases and CI

Pushing a version tag builds **both** installers and attaches them to a single GitHub Release:

```bash
git tag v1.3.0
git push origin v1.3.0
```

| Workflow            | Produces                          |
| ------------------- | --------------------------------- |
| `build-release.yml` | `Fix_Spotify_x.x.x_x64-setup.exe` |
| `build-android.yml` | `Fix_Spotify-x.x.x.apk`           |

Both workflows also support `workflow_dispatch`, which builds a downloadable artifact **without**
cutting a public release — the preferred way to test a change before tagging it. The Android
workflow takes a `version` input for this. It must be higher than the version already installed on
the test device, or Android will refuse to install over the top of it.

---

## Testing

The project keeps a small number of dependency-free checks over the logic most likely to break
silently. There is no test framework to install.

```bash
# Backend
python components/test_radio_sources.py       # radio resolves across all enabled sources
python components/test_soundcloud_format.py   # never select an HLS playlist or a preview snippet
python mobile/python/test_youtube_toggle.py   # the YouTube source gates stay in sync

# Frontend
cd frontend
node src/utils/queue.test.mjs                 # queued songs play in the order they were added
node src/utils/eq.test.mjs                    # EQ curves resolve, clamp, and stay flat when off
node src/utils/pins.test.mjs                  # pinned rows sort to the top and notify
node src/utils/downloads.test.mjs             # a download resolves the same way on read and delete
```

---

## Contributing

1. Fork the repository and create a feature branch.
2. Set up the development environment (see [Building from source](#building-from-source)).
3. Make your changes and verify them (`npm run tauri dev`, or by building and installing the APK).
4. Open a pull request describing the change and why it is needed.

---

## Disclaimer

This software is provided **for educational and personal use only**. It demonstrates how to build
cross-platform applications with Tauri, React, Android and Python.

- The project does **not** host, store or distribute any copyrighted content.
- Users are responsible for ensuring their use complies with applicable law and with the terms of
  service of the third-party platforms involved.
- The developers assume **no liability** for misuse of this software.
- Support the artists you love: buy their music, and use official streaming services.

---

## License

Licensed under the **GNU General Public License v3.0** — see [LICENSE](LICENSE).

You may use, modify and distribute this software, provided that any derivative work is distributed
under the same licence.

---

<div align="center">

Maintained by [AshirwadRai](https://github.com/AshirwadRai)

</div>
