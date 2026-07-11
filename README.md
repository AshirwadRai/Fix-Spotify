# Fix_Spotify

A multi-source music search, streaming, and download desktop app for Windows. Built with [Tauri v2](https://v2.tauri.app/) (Rust + React) and a Python [FastAPI](https://fastapi.tiangolo.com/) backend.

## Features

- **Multi-source search** — JioSaavn, SoundCloud, and YouTube results merged and deduplicated
- **Streaming** — play any track instantly with real-time bitrate/codec info
- **Downloads** — queue-based downloads with automatic metadata enrichment (iTunes + MusicBrainz)
- **Lyrics** — synced (line-by-line) and plain lyrics via lrclib
- **Radio** — auto-generated stations from any song
- **Library** — playlists, liked songs, albums, and artist views
- **Now Playing** — full-screen panel with artwork, queue, shuffle/repeat

## Install (Users)

Download the latest installer from [**Releases**](https://github.com/XMrNooBX/Fix-Spotify/releases/latest) and run it. Everything is bundled — no extra setup needed.

> **Note:** On first launch, Windows may download the WebView2 runtime (~2 MB) if it's not already installed (it ships with Windows 11 and recent Windows 10 updates).

---

## Build from Source (Developers)

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| **Python** | 3.11+ | [python.org](https://www.python.org/downloads/) |
| **Node.js** | 20+ | [nodejs.org](https://nodejs.org/) |
| **Rust** | 1.88+ | [rustup.rs](https://rustup.rs/) |
| **FFmpeg** (shared build) | 7.x | [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/releases) |
| **Deno** | 2.x | [deno.land](https://deno.land/) |

### 1. Clone

```bash
git clone https://github.com/XMrNooBX/Fix-Spotify.git
cd Fix-Spotify
```

### 2. Python backend

```powershell
# Create a virtual environment (recommended)
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install dependencies + PyInstaller
pip install -r api/requirements.txt
pip install pyinstaller
```

### 3. Vendor binaries

Download and place these in `vendor/bin/`:

```
vendor/
  bin/
    ffmpeg.exe
    ffprobe.exe
    deno.exe
    avcodec-63.dll      # from FFmpeg shared build
    avdevice-63.dll
    avfilter-12.dll
    avformat-63.dll
    avutil-61.dll
    swresample-7.dll
    swscale-10.dll
```

**Quick download (PowerShell):**

```powershell
# FFmpeg (shared build)
Invoke-WebRequest "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip" -OutFile ffmpeg.zip
Expand-Archive ffmpeg.zip -DestinationPath ffmpeg-tmp
Copy-Item ffmpeg-tmp/*/bin/* vendor/bin/ -Force
Remove-Item ffmpeg.zip, ffmpeg-tmp -Recurse

# Deno
Invoke-WebRequest "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip" -OutFile deno.zip
Expand-Archive deno.zip -DestinationPath vendor/bin -Force
Remove-Item deno.zip
```

### 4. Build the Python sidecar

```powershell
.\build_backend.ps1
```

This runs PyInstaller with `backend.spec` and copies the resulting `backend.exe` to the Tauri sidecar location.

### 5. Frontend

```powershell
cd frontend
npm install
```

### 6. Run in development

```powershell
npm run tauri dev
```

### 7. Build the installer

```powershell
npm run tauri build
```

The NSIS installer will be at:
```
frontend/src-tauri/target/release/bundle/nsis/Fix_Spotify_<version>_x64-setup.exe
```

---

## Architecture

```
Fix-Spotify/
├── api/                    # FastAPI backend (Python)
│   └── main.py             # REST API server (search, stream, download, lyrics)
├── components/             # Python backend modules
│   ├── unified_search.py   # Multi-source search engine
│   ├── source_merger.py    # Track deduplication & merging
│   ├── download_manager.py # Queue-based download system
│   ├── jiosaavn_downloader.py
│   ├── soundcloud_downloader.py
│   ├── youtube_downloader.py
│   ├── metadata_enricher.py  # iTunes/MusicBrainz metadata
│   └── ...
├── frontend/               # Tauri + React (Vite)
│   ├── src/                # React components & UI
│   ├── src-tauri/          # Rust shell (sidecar management, IPC)
│   └── package.json
├── vendor/                 # Runtime binaries (gitignored)
│   └── bin/                # ffmpeg, ffprobe, deno
├── backend.spec            # PyInstaller build spec
├── build_backend.ps1       # Sidecar build script
└── .github/workflows/      # CI/CD
    └── build-release.yml   # Auto-build installer on version tags
```

**How it works:** Tauri launches the React frontend in a webview and spawns the Python backend as a sidecar process. The frontend talks to the backend over HTTP (`127.0.0.1:8765`). FFmpeg/ffprobe and Deno are bundled as Tauri resources.

---

## CI/CD

Pushing a version tag triggers an automated build on GitHub Actions:

```powershell
git tag v1.0.1
git push origin main --tags
```

The workflow builds the Python sidecar, downloads vendor binaries, builds the Tauri installer, and publishes it as a GitHub Release.

---

## License

MIT © [XMrNooBX](https://github.com/XMrNooBX)
