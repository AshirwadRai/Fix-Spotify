<div align="center">

# 🎵 Fix_Spotify

**A multi-source music search, streaming, and download desktop app**

[![Release](https://img.shields.io/github/v/release/XMrNooBX/Fix-Spotify?style=for-the-badge&color=1DB954&label=Download)](https://github.com/XMrNooBX/Fix-Spotify/releases/latest)
[![License](https://img.shields.io/github/license/XMrNooBX/Fix-Spotify?style=for-the-badge&color=blue)](LICENSE)
[![Build](https://img.shields.io/github/actions/workflow/status/XMrNooBX/Fix-Spotify/build-release.yml?style=for-the-badge&label=Build)](https://github.com/XMrNooBX/Fix-Spotify/actions)

Search, stream, and download music from **JioSaavn**, **SoundCloud**, and **YouTube** — all from one beautiful desktop app.

Built with [Tauri v2](https://v2.tauri.app/) + [React](https://react.dev/) + [Python](https://www.python.org/)

</div>

---

> [!IMPORTANT]
> **This project is for educational and personal use only.** It is intended as a learning resource for building desktop applications with Tauri, React, and Python. Please respect the terms of service of the music platforms and the rights of content creators. The developers are not responsible for any misuse of this software.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔍 **Multi-Source Search** | Search across JioSaavn, SoundCloud, and YouTube simultaneously — results are merged and deduplicated |
| 🎧 **Instant Streaming** | Play any track directly in the app with real-time bitrate and codec info |
| ⬇️ **Smart Downloads** | Queue-based downloads with progress tracking and automatic retry |
| 🏷️ **Metadata Enrichment** | Every download gets clean metadata — artist, album, genre, release date, and hi-res cover art (via iTunes + MusicBrainz) |
| 🎤 **Lyrics** | Synced (line-by-line) and plain lyrics powered by lrclib |
| 📻 **Radio** | Auto-generated stations based on any song you're listening to |
| 📚 **Library** | Create playlists, like songs, browse albums and artists |
| 🎨 **Now Playing** | Full-screen player with album art, queue management, shuffle and repeat |
| 🖥️ **Native Desktop** | Lightweight, fast, native Windows app — not an Electron wrapper |

---

## 📥 Download & Install

### For Users (just want to use the app)

1. Go to the [**Releases**](https://github.com/XMrNooBX/Fix-Spotify/releases/latest) page
2. Download `Fix_Spotify_x.x.x_x64-setup.exe`
3. Run the installer
4. Launch **Fix_Spotify** from your Start Menu

That's it — everything is bundled. No Python, Node, or Rust needed.

> **Note:** On first launch, Windows may download the WebView2 runtime (~2 MB) if it isn't already installed. This is automatic and only happens once. WebView2 ships with Windows 11 and recent Windows 10 updates, so most users already have it.

> **Windows SmartScreen:** Since the app isn't code-signed, Windows may show a SmartScreen warning. Click **"More info"** → **"Run anyway"** to proceed.

---

## 🛠️ Build from Source

For developers who want to contribute, modify, or build the app themselves.

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| **Python** | 3.11+ | [python.org](https://www.python.org/downloads/) |
| **Node.js** | 20+ | [nodejs.org](https://nodejs.org/) |
| **Rust** | 1.88+ | [rustup.rs](https://rustup.rs/) |

### Step-by-step

```powershell
# 1. Clone the repo
git clone https://github.com/XMrNooBX/Fix-Spotify.git
cd Fix-Spotify
```

```powershell
# 2. Set up Python environment
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r api/requirements.txt
pip install pyinstaller
```

```powershell
# 3. Download vendor binaries (FFmpeg + Deno)
#    These are runtime dependencies bundled into the final app.
New-Item -ItemType Directory -Force -Path "vendor/bin" | Out-Null

# FFmpeg (shared build — provides ffmpeg.exe, ffprobe.exe, and DLLs)
Invoke-WebRequest "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip" -OutFile ffmpeg.zip
Expand-Archive ffmpeg.zip -DestinationPath ffmpeg-tmp -Force
Copy-Item ffmpeg-tmp/*/bin/* vendor/bin/ -Force
Remove-Item ffmpeg.zip, ffmpeg-tmp -Recurse -Force

# Deno (JavaScript runtime used by yt-dlp for YouTube signature decryption)
Invoke-WebRequest "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip" -OutFile deno.zip
Expand-Archive deno.zip -DestinationPath vendor/bin -Force
Remove-Item deno.zip -Force
```

```powershell
# 4. Build the Python backend into a standalone exe
.\build_backend.ps1
```

```powershell
# 5. Install frontend dependencies
cd frontend
npm install
```

```powershell
# 6. Run in development mode (hot-reload)
npm run tauri dev
```

```powershell
# 7. OR build the installer
npm run tauri build
# Output: frontend/src-tauri/target/release/bundle/nsis/Fix_Spotify_x.x.x_x64-setup.exe
```

---

## 🏗️ Architecture

```
Fix-Spotify/
├── api/                        # Python backend (FastAPI)
│   ├── main.py                 # REST API — search, stream, download, lyrics
│   └── requirements.txt        # Python dependencies
│
├── components/                 # Python backend modules
│   ├── unified_search.py       # Multi-source search engine
│   ├── source_merger.py        # Track deduplication & merging
│   ├── fuzzy_matcher.py        # Fuzzy string matching for merging
│   ├── download_manager.py     # Queue-based download system
│   ├── metadata_enricher.py    # iTunes/MusicBrainz metadata lookup
│   ├── jiosaavn_downloader.py  # JioSaavn client
│   ├── soundcloud_downloader.py# SoundCloud client
│   ├── youtube_downloader.py   # YouTube/YouTube Music client
│   ├── itunes_client.py        # iTunes Search API
│   ├── musicbrainz_client.py   # MusicBrainz API
│   ├── home.py                 # Home/discover feed
│   ├── profile.py              # Artist/album profile fetcher
│   └── radio.py                # Radio station generator
│
├── frontend/                   # Desktop UI (Tauri v2 + React)
│   ├── src/                    # React components, state, utilities
│   ├── src-tauri/              # Rust shell — sidecar mgmt, window, IPC
│   │   ├── src/main.rs         # App entry point, plugin setup
│   │   ├── src/backend.rs      # Python sidecar lifecycle
│   │   ├── src/commands.rs     # Tauri IPC commands
│   │   ├── src/download.rs     # Download queue bridge
│   │   └── tauri.conf.json     # Tauri build & bundle config
│   └── package.json            # Node dependencies
│
├── vendor/                     # Runtime binaries (gitignored)
│   └── bin/                    # ffmpeg, ffprobe, deno
│
├── backend.spec                # PyInstaller build recipe
├── build_backend.ps1           # Script to build Python sidecar
└── .github/workflows/
    └── build-release.yml       # CI/CD — auto-build on version tags
```

### How It Works

```
┌──────────────┐     HTTP API      ┌──────────────────┐
│   Tauri App  │ ◄──────────────►  │  Python Backend   │
│  (Rust +     │   127.0.0.1:8765  │  (FastAPI server) │
│   React UI)  │                   │                   │
└──────┬───────┘                   └────────┬──────────┘
       │                                    │
       │ Webview                            │ HTTP requests
       │                                    │
  ┌────▼────┐                    ┌──────────▼──────────┐
  │  User   │                    │  JioSaavn / SC / YT │
  │Interface│                    │  iTunes / MusicBrainz│
  └─────────┘                    └─────────────────────┘
```

**Tauri** launches the React frontend in a native webview and spawns the Python backend as a **sidecar process**. The frontend communicates with the backend over a local HTTP API. FFmpeg, ffprobe, and Deno are bundled as Tauri resources alongside the app.

---

## 🔄 CI/CD

Every version tag triggers an automated build on GitHub Actions:

```powershell
git tag v1.0.1
git push origin main --tags
```

GitHub builds the complete installer (Python sidecar + vendor binaries + Tauri app) and publishes it as a [Release](https://github.com/XMrNooBX/Fix-Spotify/releases). No local build needed for releases.

---

## 🤝 Contributing

Contributions are welcome! Here's how:

1. **Fork** the repository
2. **Clone** your fork and set up the dev environment (see [Build from Source](#️-build-from-source))
3. Create a **feature branch** (`git checkout -b feature/my-feature`)
4. Make your changes and test with `npm run tauri dev`
5. **Commit** with a descriptive message
6. **Push** to your fork and open a **Pull Request**

---

## ⚠️ Disclaimer

This software is provided **for educational and personal use only**. It is a demonstration of how to build cross-platform desktop applications using modern web technologies (Tauri, React, FastAPI).

- This project does **not** host, store, or distribute any copyrighted content
- Users are responsible for ensuring their use complies with applicable laws and the terms of service of third-party platforms
- The developers assume **no liability** for misuse of this software
- Support the artists you love by purchasing their music and using official streaming services

---

## 📄 License

This project is licensed under the **GNU General Public License v3.0** — see the [LICENSE](LICENSE) file for details.

You are free to use, modify, and distribute this software, provided that any derivative work is also distributed under the same license.

---

<div align="center">

Made with ❤️ by [XMrNooBX](https://github.com/XMrNooBX)

</div>
