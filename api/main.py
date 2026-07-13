"""
FastAPI Backend Server
=======================
REST API for the music search and download components.
"""

import asyncio
import re
import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query, Request
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Dict, Any
import sys
import os
import requests as http_requests
from requests.adapters import HTTPAdapter
from dataclasses import asdict, is_dataclass, replace
from html import unescape


def _add_bundled_binaries_to_path():
    """Make the bundled ffmpeg/ffprobe + Deno (yt-dlp's JS runtime) discoverable
    in the packaged EXE. They ship as Tauri resources next to the app; the Rust
    launcher passes that dir via FIX_SPOTIFY_BIN. A frozen PyInstaller onefile
    would instead expose them under its temp dir / next to the executable.
    Prepend whichever exists to PATH — that's the single mechanism yt-dlp (for
    both ffmpeg and the Deno EJS runtime) and our ffprobe probe already use, so
    no path needs threading through individual calls. In dev these tools are on
    the system PATH already, so every candidate simply misses. ponytail: PATH is
    the one lever; upgrade path if it ever proves flaky = pass explicit
    ffmpeg_location / js_runtimes paths into yt-dlp opts."""
    candidates = []
    env_bin = os.environ.get("FIX_SPOTIFY_BIN")
    if env_bin:
        candidates.append(env_bin)
    if getattr(sys, "frozen", False):
        candidates.append(getattr(sys, "_MEIPASS", ""))
        candidates.append(os.path.dirname(sys.executable))
    existing = os.environ.get("PATH", "")
    parts = existing.split(os.pathsep)
    for d in candidates:
        if d and os.path.isdir(d) and d not in parts:
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


_add_bundled_binaries_to_path()

# Add parent directory to path for components
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from components.unified_search import UnifiedSearchService
from components.source_merger import SourceType
from components.download_manager import DownloadManager, DownloadQueueConfig
from components.metadata_enricher import MetadataEnricher

# Global service instances
_search_service: Optional[UnifiedSearchService] = None
_download_manager: Optional[DownloadManager] = None
_enricher: Optional[MetadataEnricher] = None

# ── Lyrics: pooled HTTP session + permanent cache ──────────────────────────
# lrclib can be slow to make a fresh TLS connection from some networks
# (cold connects routinely exceed a one-shot timeout, so we'd abandon synced
# lyrics that actually exist). A pooled Session with retries reuses warm
# connections and survives transient timeouts/429s — the single biggest
# reliability win for lyrics. Results are cached permanently (lyrics never
# change) so reopening the panel or replaying a song is instant.
def _build_lyrics_session() -> http_requests.Session:
    s = http_requests.Session()
    try:
        from urllib3.util.retry import Retry
        # Only retry cheap CONNECT failures (cold TLS handshake). Do NOT retry
        # slow reads or 429s — those multiply per-attempt timeouts and blow the
        # lookup deadline. Connection POOLING is the real win: the old code used
        # requests.get() which opened a fresh TLS connection on every lrclib
        # call; reusing a warm connection makes the whole lookup far faster.
        retry = Retry(total=1, connect=1, read=0, status=0, backoff_factor=0.2,
                      allowed_methods=frozenset(["GET"]))
        adapter = HTTPAdapter(max_retries=retry, pool_connections=4, pool_maxsize=8)
        s.mount("https://", adapter)
        s.mount("http://", adapter)
    except Exception:
        pass
    return s


_lyrics_session = _build_lyrics_session()
_lyrics_cache: Dict[str, Dict[str, Any]] = {}
_lyrics_cache_lock = threading.Lock()
_LYRICS_CACHE_MAX = 1000


def get_default_download_dir() -> str:
    """The default downloads location: the user's Music folder under a
    Fix_Spotify subfolder. Created if missing. Works in dev and the EXE."""
    from pathlib import Path
    music = Path.home() / "Music" / "Fix_Spotify"
    try:
        music.mkdir(parents=True, exist_ok=True)
    except Exception:
        # Fall back to a writable temp location if Music isn't available
        music = Path.home() / "Fix_Spotify_Downloads"
        music.mkdir(parents=True, exist_ok=True)
    return str(music)


# ── YouTube account connection (optional, opt-in) ──────────────────────────
# YouTube is bot-blocked for anonymous yt-dlp, so YouTube-only tracks don't
# stream out of the box. A user can opt in by connecting their browser's
# YouTube login: yt-dlp then reads that browser's cookies. The choice (browser
# name) is persisted so it survives restarts. Off by default — the app works
# great on JioSaavn + SoundCloud without it.
import json
from pathlib import Path

# Browsers yt-dlp can read cookies from (cookiesfrombrowser). Whitelisted so a
# bad value can't be handed to yt-dlp.
YT_BROWSERS = {"chrome", "edge", "brave", "firefox", "opera", "vivaldi", "chromium"}

_yt_browser: Optional[str] = None     # connected browser name, or None
_yt_cookiefile: Optional[str] = None  # path to an imported cookies.txt, or None
# ponytail: plain globals read by stream-resolve worker threads while the
# connect/disconnect endpoints mutate them — no lock. Harmless for a local
# single-user desktop app (worst case: one in-flight stream uses the prior
# source). Upgrade path if it ever matters: a small lock or an immutable snapshot.


def _config_path() -> Path:
    d = Path.home() / ".fix_spotify"
    d.mkdir(parents=True, exist_ok=True)
    return d / "config.json"


def _cookies_path() -> Path:
    """Where an imported cookies.txt is stored (read by yt-dlp at stream time)."""
    return Path.home() / ".fix_spotify" / "cookies.txt"


def _load_config() -> dict:
    try:
        return json.loads(_config_path().read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_config(cfg: dict) -> None:
    try:
        _config_path().write_text(json.dumps(cfg), encoding="utf-8")
    except Exception:
        pass


def _set_youtube_browser(browser: Optional[str]) -> None:
    """Connect via a browser's cookies (clears any imported cookies.txt)."""
    global _yt_browser, _yt_cookiefile
    _yt_browser = browser if browser in YT_BROWSERS else None
    if _yt_browser:
        _yt_cookiefile = None


def _set_youtube_cookiefile(path: Optional[str]) -> None:
    """Connect via an imported cookies.txt (clears any browser selection)."""
    global _yt_browser, _yt_cookiefile
    _yt_cookiefile = path if (path and os.path.exists(path)) else None
    if _yt_cookiefile:
        _yt_browser = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global _search_service, _download_manager, _enricher
    # Startup
    _search_service = UnifiedSearchService()
    _download_manager = DownloadManager(
        config=DownloadQueueConfig(max_concurrent=3),
        download_dir=get_default_download_dir(),
    )
    _download_manager.start()
    _enricher = MetadataEnricher()
    # Every downloaded file is embedded with FINAL clean metadata (clean
    # artist/album, hi-res cover, genre, release date) regardless of which
    # screen triggered the download — see _finalize_track_info.
    _download_manager.set_finalizer(_finalize_track_info)
    # YouTube downloads use the same connected account as streaming (read live).
    _download_manager.set_youtube_cookie_provider(
        lambda: {"cookies_file": _yt_cookiefile, "cookies_from_browser": _yt_browser}
    )
    # Restore the opt-in YouTube connection from last run (imported cookies.txt
    # takes priority over a browser selection).
    _cfg = _load_config()
    if _cfg.get("youtube_cookiefile"):
        _set_youtube_cookiefile(_cfg.get("youtube_cookiefile"))
    elif _cfg.get("youtube_browser"):
        _set_youtube_browser(_cfg.get("youtube_browser"))
    # Warm the lyrics HTTP connection in the background so the FIRST user lyrics
    # request doesn't pay a ~6s cold TLS handshake (which used to cascade past
    # the lookup deadline and drop synced lyrics). Best-effort, never blocks.
    def _warm_lyrics():
        try:
            _lyrics_session.get("https://lrclib.net/api/search",
                                params={"q": "hello"}, timeout=10)
        except Exception:
            pass
    threading.Thread(target=_warm_lyrics, daemon=True).start()

    # Warm the SEARCH path too. The first user search used to pay a cold penalty
    # (~2x slower, measured 3.9s vs 1.8s): lazy client imports (yt-dlp is heavy),
    # SoundCloud client_id resolution, and cold TLS to each source. A throwaway
    # warm-up search in the background instantiates the playable-source clients
    # and opens their connections so the user's first real search is already
    # warm. Best-effort, never blocks startup.
    def _warm_search():
        try:
            cfg = replace(
                _search_service.config, max_total_results=5,
                enabled_sources=PLAYABLE_SEARCH_SOURCES,
                timeout_seconds=15.0,
            )
            _search_service.search("hello", cfg)
        except Exception:
            pass
    threading.Thread(target=_warm_search, daemon=True).start()
    yield
    # Shutdown
    if _search_service:
        _search_service.shutdown()
        _search_service = None
    if _download_manager:
        _download_manager.stop()
        _download_manager = None
    _enricher = None

app = FastAPI(
    title="Music Search API",
    description="API for searching and downloading music from multiple sources",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for frontend — must include the Tauri v2 webview origin
# (https://tauri.localhost) or every fetch() from the packaged EXE gets
# CORS-blocked. In dev the Vite proxy at :5173 masks this.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "https://tauri.localhost",
        "http://tauri.localhost",
        "tauri://localhost",
        "null",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== PYDANTIC MODELS ====================


class SearchRequest(BaseModel):
    query: str
    limit: int = 20

    @field_validator("query")
    @classmethod
    def query_must_not_be_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Query must not be empty")
        return v

    @field_validator("limit")
    @classmethod
    def limit_must_be_reasonable(cls, v: int) -> int:
        if v < 1:
            return 1
        if v > 100:
            return 100
        return v


class SearchResult(BaseModel):
    title: str
    artist: str
    album: Optional[str] = None
    duration_ms: Optional[int] = None
    isrc: Optional[str] = None
    sources: Dict[str, Any] = Field(default_factory=dict)
    primary_source: Optional[str] = None
    search_score: float = 0.0
    artwork_url: Optional[str] = None
    artwork_urls: Dict[str, str] = Field(default_factory=dict)
    is_playable: bool = False
    playable_source: Optional[str] = None


class SearchResponse(BaseModel):
    results: List[SearchResult]
    total: int
    query: str


class StreamRequest(BaseModel):
    url: str
    source: str

class StreamResponse(BaseModel):
    stream_url: Optional[str] = None
    error: Optional[str] = None


class DownloadRequest(BaseModel):
    url: str
    track_info: Dict[str, Any]
    output_dir: str = ""
    max_bitrate: int = 256

    @field_validator("url")
    @classmethod
    def url_must_not_be_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("URL must not be empty")
        return v

    @field_validator("output_dir")
    @classmethod
    def output_dir_sane(cls, v: str) -> str:
        """This is a local desktop app that writes to user-chosen folders, so
        absolute paths are expected. We only reject obviously malformed input;
        the endpoint resolves an empty value to the default Music directory and
        confines the final file to that directory tree."""
        v = (v or "").strip()
        if "\x00" in v:
            raise ValueError("output_dir contains a null byte")
        return v

    @field_validator("max_bitrate")
    @classmethod
    def max_bitrate_must_be_reasonable(cls, v: int) -> int:
        if v < 64:
            return 64
        if v > 320:
            return 320
        return v


class DownloadResponse(BaseModel):
    task_id: str
    status: str
    message: str

class DownloadStatusResponse(BaseModel):
    task_id: str
    status: str
    progress: float
    downloaded_bytes: int
    total_bytes: int
    file_path: Optional[str] = None
    error: Optional[str] = None


# ==================== API ENDPOINTS ====================

PLAYABLE_SOURCES = {"jiosaavn", "soundcloud", "youtube", "youtube_music"}

# The sources a normal search queries. Only PLAYABLE sources matter: iTunes and
# MusicBrainz are metadata-only (no stream URL), so their hits are dropped by
# _playable_source_name anyway — querying them just made the user wait for the
# slowest source (MusicBrainz is throttled to 1 req/sec). Clean metadata still
# arrives progressively via /api/enrich.
PLAYABLE_SEARCH_SOURCES = {SourceType.JIOSAAVN, SourceType.SOUNDCLOUD, SourceType.YOUTUBE}


def _clean_text(value: Optional[str]) -> Optional[str]:
    """Decode API/entity noise before it reaches the UI."""
    if value is None:
        return None
    cleaned = unescape(str(value))
    replacements = {
        "\u00c2\u00b7": "·",
        "\u00e2\u20ac\u2122": "'",
        "\u00e2\u20ac\u0153": '"',
        "\u00e2\u20ac\u009d": '"',
        "\u00e2\u20ac\u201c": "-",
        "\u00e2\u20ac\u201d": "-",
    }
    for bad, good in replacements.items():
        cleaned = cleaned.replace(bad, good)
    cleaned = cleaned.replace("\u00c2\u00b7", "\u00b7")
    return " ".join(cleaned.split())


def _finalize_track_info(info: Dict[str, Any]) -> Dict[str, Any]:
    """Produce the FINAL clean/complete metadata embedded into a downloaded
    file, so every download is consistent no matter which screen triggered it
    (search, album, artist, radio, now-playing).

    Overlays iTunes' clean artist/album/genre/release-date + a hi-res (600px)
    cover when a confident match is found; otherwise keeps the track's original
    metadata. Best-effort — never raises (download must still complete)."""
    if not isinstance(info, dict):
        return info
    out = dict(info)
    # JioSaavn metadata is clean/correct for its own catalog; iTunes tends to
    # mangle it ("(Original Motion Picture Soundtrack)", "A, B"→"A & B", or a
    # mismatch). Mirror the display rule (utils/tracks.applyEnrichment): for a
    # JioSaavn track, KEEP its artist/album (gap-fill only) so the embedded tags
    # match what's on screen. Artwork/genre/date/isrc always overlay (pure gain).
    src = info.get("sources") if isinstance(info.get("sources"), dict) else {}
    from_jiosaavn = bool((src.get("jiosaavn") or {}).get("url")) \
        or info.get("playable_source") == "jiosaavn" \
        or info.get("primary_source") == "jiosaavn"
    try:
        meta = _enricher._lookup(  # noqa: SLF001 (intentional internal reuse)
            info.get("title") or "",
            info.get("artist") or "",
            info.get("isrc"),
            info.get("duration_ms"),
        ) if _enricher else None
    except Exception:
        meta = None

    if meta:
        if meta.get("artist") and not (from_jiosaavn and out.get("artist")):
            out["artist"] = _clean_text(meta["artist"])
        if meta.get("album") and not (from_jiosaavn and out.get("album")):
            out["album"] = _clean_text(meta["album"])
        if meta.get("release_date"):
            out["release_date"] = meta["release_date"]
        if meta.get("genre"):
            out["genre"] = meta["genre"]
        if meta.get("isrc") and not out.get("isrc"):
            out["isrc"] = meta["isrc"]
        art = meta.get("artwork") or {}
        cover = art.get("600") or art.get("300") or art.get("100")
        if cover:
            # '600' is the top priority key in _extract_cover_url, so the
            # embedded cover becomes the hi-res iTunes art.
            au = dict(out.get("artwork_urls") or {})
            au["600"] = cover
            out["artwork_urls"] = au
            out["artwork_url"] = cover
    return out


def _source_to_dict(source: Any) -> Dict[str, Any]:
    if hasattr(source, "to_dict"):
        return source.to_dict()
    if is_dataclass(source):
        return asdict(source)
    if isinstance(source, dict):
        return source
    return {}


def _playable_source_name(track: Any) -> Optional[str]:
    primary = getattr(track, "primary_source", None)
    if primary and getattr(primary, "value", primary) in PLAYABLE_SOURCES:
        primary_name = getattr(primary, "value", primary)
        primary_source = getattr(track, "sources", {}).get(primary)
        primary_data = _source_to_dict(primary_source)
        if primary_data.get("url"):
            return primary_name

    for source_key, source in getattr(track, "sources", {}).items():
        source_name = getattr(source_key, "value", source_key)
        source_data = _source_to_dict(source)
        if source_name in PLAYABLE_SOURCES and source_data.get("url"):
            return source_name
    return None


def _clean_artwork_urls(artwork_urls: Dict[str, Any]) -> Dict[str, str]:
    return {
        str(size): url
        for size, url in (artwork_urls or {}).items()
        if isinstance(url, str) and url
    }


def _resolve_stream_url(url: str, source: str, bitrate: int = 320) -> Optional[str]:
    """Resolve a source page URL into a direct, playable streaming URL.
    Shared by /api/stream_url, /api/proxy_stream and /api/stream_info."""
    if source in ("youtube", "youtube_music"):
        from components.youtube_downloader import YouTubeClient
        # Use the user's connection (imported cookies.txt or browser cookies, if
        # any) so signed-in users can stream otherwise bot-blocked YouTube videos.
        return YouTubeClient(
            cookies_file=_yt_cookiefile, cookies_from_browser=_yt_browser
        ).get_streaming_url(url, bitrate)
    elif source == "jiosaavn":
        from components.jiosaavn_downloader import JioSaavnClient
        # JioSaavn supports discrete bitrates: 320, 160, 96
        js_bitrate = 320 if bitrate >= 320 else (160 if bitrate >= 160 else 96)
        return JioSaavnClient().get_streaming_url(url, js_bitrate)
    elif source == "soundcloud":
        from components.soundcloud_downloader import SoundCloudClient
        return SoundCloudClient().get_streaming_url(url, bitrate)
    return None


def _probe_stream_bitrate(stream_url: str, source: str) -> Dict[str, Any]:
    """Run ffprobe against a resolved stream URL to get its real bitrate/codec.
    Returns {bitrate_kbps, codec} — best effort, never raises."""
    import subprocess
    import json as _json

    headers = "User-Agent: Mozilla/5.0\r\n"
    if source == "jiosaavn":
        headers += "Referer: https://www.jiosaavn.com/\r\n"

    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-headers", headers,
                "-analyzeduration", "2000000", "-probesize", "1000000",
                "-show_entries", "format=bit_rate:stream=bit_rate,codec_name",
                "-select_streams", "a:0",
                "-of", "json",
                stream_url,
            ],
            capture_output=True, text=True, timeout=20,
            # Suppress the console window flash on Windows (every ffprobe run
            # otherwise pops a visible cmd window when playing a new song).
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if result.returncode == 0 and result.stdout.strip():
            data = _json.loads(result.stdout)
            fmt = data.get("format", {})
            streams = data.get("streams", [{}])
            stream0 = streams[0] if streams else {}
            # Prefer stream bitrate, fall back to format bitrate
            raw_bps = stream0.get("bit_rate") or fmt.get("bit_rate")
            codec = stream0.get("codec_name")
            bitrate_kbps = None
            if raw_bps and str(raw_bps).isdigit():
                bitrate_kbps = round(int(raw_bps) / 1000)
            return {"bitrate_kbps": bitrate_kbps, "codec": codec}
    except Exception:
        pass
    return {"bitrate_kbps": None, "codec": None}


@app.get("/")
async def root():
    return {"message": "Music Search API", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/api/connectivity")
async def connectivity():
    """Quick check whether the backend can actually reach the internet.
    Used by the frontend to distinguish 'offline' from 'no search results'."""
    def _probe() -> bool:
        # Try a couple of reliable, fast endpoints
        for url in ("https://www.google.com", "https://1.1.1.1"):
            try:
                http_requests.head(url, timeout=4, allow_redirects=False)
                return True
            except Exception:
                continue
        return False

    online = await asyncio.to_thread(_probe)
    return {"online": online}


@app.post("/api/search", response_model=SearchResponse)
async def search_tracks(request: SearchRequest):
    """Search for tracks across all sources."""
    try:
        if _search_service is None:
            raise HTTPException(status_code=503, detail="Search service not ready")

        # One search algorithm (no modes). Query only the playable sources, with
        # a ceiling so a single hung source can't stall the whole response.
        # Per-request config copy — never mutate the shared service config
        # (/api/search and /api/search/suggestions hit the SAME service, and
        # suggestions fire on every keystroke; replace() isolates this request).
        req_config = replace(
            _search_service.config,
            max_total_results=request.limit,
            enabled_sources=PLAYABLE_SEARCH_SOURCES,
            timeout_seconds=12.0,
        )

        # Run blocking search in a thread to avoid blocking the event loop
        results = await asyncio.to_thread(_search_service.search, request.query, req_config)

        # Convert to response format (metadata enrichment happens progressively
        # via /api/enrich so search results appear instantly)
        search_results = []
        for track in results:
            playable_source = _playable_source_name(track)
            if not playable_source:
                continue

            sources = {
                k.value: _source_to_dict(v)
                for k, v in track.sources.items()
            }
            artwork_urls = _clean_artwork_urls(getattr(track, "artwork_urls", {}))
            search_results.append(
                SearchResult(
                    title=_clean_text(track.title) or "",
                    artist=_clean_text(track.artist) or "",
                    album=_clean_text(track.album),
                    duration_ms=track.duration_ms,
                    isrc=track.isrc,
                    sources=sources,
                    primary_source=playable_source,
                    search_score=track.search_score,
                    artwork_url=track.get_best_artwork()
                    if hasattr(track, "get_best_artwork")
                    else None,
                    artwork_urls=artwork_urls,
                    is_playable=True,
                    playable_source=playable_source,
                )
            )

        return SearchResponse(
            results=search_results, total=len(search_results), query=request.query
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/search/suggestions")
async def search_suggestions(q: str, limit: int = 8):
    """Get autocomplete suggestions for the query."""
    try:
        if len(q) < 2:
            return {"suggestions": []}

        if _search_service is None:
            return {"suggestions": []}

        # Cap limit
        limit = min(max(limit, 1), 20)

        # Per-request config copy (see /api/search) — avoids racing the shared
        # config with concurrent full searches. Suggestions fire on every
        # debounced keystroke, so they must be CHEAP: query JioSaavn only (fast
        # autocomplete-grade results) instead of all five sources. The old code
        # ran the full 5-source search per keystroke — including MusicBrainz
        # (throttled 1 req/sec) — which made typing sluggish and loaded the
        # backend right before the real search fired.
        req_config = replace(
            _search_service.config,
            max_total_results=limit,
            enabled_sources={SourceType.JIOSAAVN},
            max_results_per_source=limit,
            timeout_seconds=6.0,
        )

        # Run blocking search in a thread to avoid blocking the event loop
        results = await asyncio.to_thread(_search_service.search, q, req_config)

        # Deduplicate quickly
        seen = set()
        suggestions = []
        for track in results:
            key = f"{track.title.lower()}|{track.artist.lower()}"
            if key not in seen:
                seen.add(key)
                suggestions.append(
                    {
                        "title": track.title,
                        "artist": track.artist,
                        "album": track.album,
                        "sources": [s.value for s in track.sources.keys()],
                        "isrc": track.isrc,
                    }
                )
                if len(suggestions) >= limit:
                    break

        return {"suggestions": suggestions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/stream_url", response_model=StreamResponse)
async def get_stream_url(request: StreamRequest):
    """Get a direct playable streaming URL for a track."""
    try:
        stream_url = await asyncio.to_thread(
            _resolve_stream_url, request.url, request.source, 320
        )

        if stream_url:
            return StreamResponse(stream_url=stream_url)
        else:
            return StreamResponse(stream_url=None, error=f"Could not extract streaming URL for source: {request.source}")

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/stream_info")
async def stream_info(
    url: str = Query(...),
    source: str = Query(...),
    bitrate: int = Query(320),
):
    """Resolve a track's real stream and report its actual bitrate + codec
    (via ffprobe). Used to show live quality info in the player."""
    try:
        stream_url = await asyncio.to_thread(_resolve_stream_url, url, source, bitrate)
        if not stream_url:
            return {"bitrate_kbps": None, "codec": None, "error": "Could not resolve stream"}

        info = await asyncio.to_thread(_probe_stream_bitrate, stream_url, source)
        return info
    except Exception as e:
        return {"bitrate_kbps": None, "codec": None, "error": str(e)}


@app.post("/api/download", response_model=DownloadResponse)
async def download_track(request: DownloadRequest):
    """Start a background download and return task_id."""
    try:
        if not _download_manager:
            raise HTTPException(status_code=500, detail="Download manager not initialized")

        import re
        from pathlib import Path

        # Resolve target directory: requested dir, else the default Music folder.
        out_dir = request.output_dir.strip() or get_default_download_dir()
        out_dir_path = Path(out_dir).expanduser()
        try:
            out_dir_path.mkdir(parents=True, exist_ok=True)
        except Exception:
            out_dir_path = Path(get_default_download_dir())

        safe_title = re.sub(r'[<>:"/\\|?*]', "_", request.track_info.get("title", "unknown")).strip() or "unknown"
        safe_artist = re.sub(r'[<>:"/\\|?*]', "_", request.track_info.get("artist", "unknown")).strip() or "unknown"
        output_path = str(out_dir_path / f"{safe_title} - {safe_artist}")

        task_id = _download_manager.add_download(
            url=request.url,
            track_info=request.track_info,
            output_path=output_path,
            max_bitrate=request.max_bitrate,
        )

        return DownloadResponse(
            task_id=task_id,
            status="queued",
            message="Download started in background"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/download/{task_id}", response_model=DownloadStatusResponse)
async def get_download_status(task_id: str):
    """Get the status of a background download task."""
    if not _download_manager:
        raise HTTPException(status_code=500, detail="Download manager not initialized")

    task = _download_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return DownloadStatusResponse(
        task_id=task.id,
        status=task.status.value,
        progress=task.progress,
        downloaded_bytes=task.downloaded_bytes,
        total_bytes=task.total_bytes,
        file_path=task.file_path,
        error=task.error
    )


@app.get("/api/downloads")
async def list_downloads():
    """List all download tasks (for the Downloads tab)."""
    if not _download_manager:
        raise HTTPException(status_code=500, detail="Download manager not initialized")
    tasks = _download_manager.get_all_tasks()
    # Newest first
    tasks.sort(key=lambda t: t.created_at, reverse=True)
    return {"tasks": [t.to_dict() for t in tasks]}


@app.get("/api/downloads/info")
async def downloads_info():
    """Return the current download directory."""
    download_dir = str(_download_manager.download_dir) if _download_manager else get_default_download_dir()
    return {"download_dir": download_dir}


@app.get("/api/downloads/local")
async def scan_local_downloads():
    """Scan the download folder and return the offline library read from each
    file's embedded tags. Disk is the source of truth, so downloads survive a
    cleared frontend registry / reinstall / backend restart. Called on app
    startup to rebuild the offline library."""
    from components.download_manager import scan_downloads
    directory = str(_download_manager.download_dir) if _download_manager else get_default_download_dir()
    try:
        tracks = scan_downloads(directory)
    except Exception:
        tracks = []
    return {"tracks": tracks, "download_dir": directory}


@app.post("/api/download/{task_id}/cancel")
async def cancel_download(task_id: str):
    """Cancel a pending/downloading task."""
    if not _download_manager:
        raise HTTPException(status_code=500, detail="Download manager not initialized")
    ok = _download_manager.cancel_task(task_id)
    return {"cancelled": ok}


@app.post("/api/download/{task_id}/retry")
async def retry_download(task_id: str):
    """Retry a failed task."""
    if not _download_manager:
        raise HTTPException(status_code=500, detail="Download manager not initialized")
    ok = _download_manager.retry_task(task_id)
    return {"retried": ok}


@app.post("/api/downloads/clear")
async def clear_completed_downloads():
    """Remove completed tasks from the queue (does NOT delete files)."""
    if not _download_manager:
        raise HTTPException(status_code=500, detail="Download manager not initialized")
    count = _download_manager.clear_completed()
    return {"cleared": count}


# Audio extensions we're willing to serve for offline playback.
_LOCAL_AUDIO_EXTS = {".m4a", ".mp3", ".flac", ".opus", ".ogg", ".wav", ".aac", ".mp4"}


@app.get("/api/local")
async def serve_local_file(request: Request, path: str = Query(...)):
    """Serve a downloaded audio file for offline playback (with range support).

    Confined to the user's home directory and audio extensions — the file path
    comes from our own download records, but we still validate to avoid serving
    arbitrary files."""
    from pathlib import Path
    try:
        real = Path(path).expanduser().resolve(strict=True)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")

    home = Path.home().resolve()
    if home not in real.parents and real != home:
        raise HTTPException(status_code=403, detail="Path not allowed")
    if real.suffix.lower() not in _LOCAL_AUDIO_EXTS:
        raise HTTPException(status_code=403, detail="Unsupported file type")
    if not real.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    # FileResponse handles Range requests (206) for seeking automatically.
    return FileResponse(str(real))


def _parse_lrc(synced: str):
    """Parse an LRC synced-lyrics string into [{time, text}] sorted by time."""
    import re as _re
    lines = []
    for raw in (synced or "").splitlines():
        # Each line may have one or more [mm:ss.xx] timestamps
        stamps = _re.findall(r"\[(\d+):(\d+(?:\.\d+)?)\]", raw)
        text = _re.sub(r"\[\d+:\d+(?:\.\d+)?\]", "", raw).strip()
        for m, s in stamps:
            t = int(m) * 60 + float(s)
            lines.append({"time": round(t, 2), "text": text})
    lines.sort(key=lambda x: x["time"])
    return lines


@app.get("/api/lyrics")
async def get_lyrics(
    title: str = Query(...),
    artist: str = Query(""),
    album: str = Query(""),
    duration: int = Query(0),
):
    """Fetch lyrics (synced when available) from lrclib.net, falling back to
    multiple search strategies. Returns {plain, synced:[{time,text}], source}."""
    import re as _re

    # Permanent cache (lyrics never change). Keyed by title|artist so reopening
    # the panel or replaying a song is instant. We DON'T key on duration/album
    # so the same song always hits regardless of how it was requested.
    cache_key = f"{(title or '').strip().lower()}|{(artist or '').strip().lower()}"
    with _lyrics_cache_lock:
        hit = _lyrics_cache.get(cache_key)
    if hit is not None:
        return hit

    def _clean_for_search(text: str) -> str:
        """Strip parenthetical noise, brackets, and common suffixes for better matching."""
        cleaned = _re.sub(r'\s*[\(\[\{].*?[\)\]\}]', '', text)
        cleaned = _re.sub(r'\s*[-|].*(?:official|video|audio|lyric|full|hd|4k|visuali).*$', '', cleaned, flags=_re.IGNORECASE)
        cleaned = _re.sub(r'\s+(?:feat\.|ft\.).*$', '', cleaned, flags=_re.IGNORECASE)
        return cleaned.strip()

    def _fetch():
        headers = {"User-Agent": "Fix_Spotify/1.0 (music player)"}
        clean_title = _clean_for_search(title)
        clean_artist = _clean_for_search(artist)

        # Overall latency cap. A complete miss can otherwise stack many slow
        # network calls (lrclib per-artist-candidate + fuzzy), and on a slow
        # network those timeouts add up. Bound the whole lookup so the user
        # isn't staring at a blank lyrics panel.
        import time as _time
        _start = _time.monotonic()
        _deadline = _start + 20      # hard cap for the entire lookup
        _ll_deadline = _start + 12   # favour lrclib (our only SYNCED source)
                                     # before falling back to JioSaavn plain

        def _http_get(url, *, timeout, **kw):
            """Pooled-session GET bounded by the global deadline. The session
            retries transient failures (timeouts/429s) and reuses warm
            connections, so flaky lrclib is far more reliable. Returns None when
            out of budget or on any network error (never raises)."""
            left = _deadline - _time.monotonic()
            if left < 1.5:
                return None
            try:
                return _lyrics_session.get(url, timeout=min(timeout, left), **kw)
            except Exception:
                return None

        # Build artist candidates: the full string plus each individual component.
        # Indian tracks often arrive as "Lyricist, Composer, Singer" (e.g.
        # "Sayeed Quadri, Pritam, KK") but lrclib indexes by a single artist name,
        # so trying each component separately greatly improves match rate.
        artist_candidates = []
        if clean_artist:
            artist_candidates.append(clean_artist)
            for sep in (",", "&", "feat.", "ft.", " x ", "/"):
                if sep in clean_artist.lower():
                    for part in _re.split(r'[,&/]| feat\.| ft\.| x ', clean_artist, flags=_re.IGNORECASE):
                        part = part.strip()
                        if part and part not in artist_candidates:
                            artist_candidates.append(part)
                    break
        if not artist_candidates:
            artist_candidates = [""]

        # Track the best plain-only result so we can fall back to it, but always
        # keep searching for a SYNCED version first (synced = highlighting works).
        plain_fallback = {"value": None}

        # ── Match validation ──────────────────────────────────────────────
        # lrclib's fuzzy /api/search happily returns a DIFFERENT song that just
        # shares a title (searching "1234" returns Feist, not the Telugu track).
        # The user would rather see no lyrics than wrong lyrics, so every
        # candidate must clear an artist/duration confidence gate before we
        # accept it. We reuse rapidfuzz (already a project dependency).
        try:
            from rapidfuzz import fuzz as _fuzz
            def _sim(a, b):
                return max(_fuzz.token_set_ratio(a, b), _fuzz.partial_ratio(a, b))
            def _artist_cmp(a, b):
                # Token overlap + despaced ratio (handles "KK" vs "K.K.").
                # Deliberately NO partial_ratio: it spuriously matches long
                # multi-artist credit strings (e.g. a 10-rapper posse track).
                return max(_fuzz.token_set_ratio(a, b),
                           _fuzz.ratio(a.replace(" ", ""), b.replace(" ", "")))
        except ImportError:
            from difflib import SequenceMatcher as _SM
            def _sim(a, b):
                return _SM(None, a, b).ratio() * 100
            def _artist_cmp(a, b):
                return max(_SM(None, a, b).ratio() * 100,
                           _SM(None, a.replace(" ", ""), b.replace(" ", "")).ratio() * 100)

        def _norm(s):
            s = _re.sub(r"[^\w\s]", " ", (s or "").lower())
            return _re.sub(r"\s+", " ", s).strip()

        def _artist_score(cand_artist):
            """Best similarity between the request's artist(s) and the candidate's.
            Checks each individual component so 'KK' still matches a track stored
            as 'Sayeed Quadri, Pritam, KK'."""
            if not clean_artist or not cand_artist:
                return 0.0
            cand = _norm(cand_artist)
            best = _artist_cmp(_norm(clean_artist), cand)
            for part in _re.split(r'[,&/]| feat\.| ft\.| x ', clean_artist, flags=_re.IGNORECASE):
                part = part.strip()
                if len(part) >= 2:
                    best = max(best, _artist_cmp(_norm(part), cand))
            return best

        def _is_valid(item):
            """True only if the candidate is confidently the SAME song."""
            title_score = _sim(_norm(clean_title), _norm(item.get("trackName") or ""))
            if title_score < 65:
                return False
            cand_dur = item.get("duration") or 0
            dur_known = bool(duration and duration > 0 and cand_dur)
            # Hard veto: same title but far-off length = a different recording.
            if dur_known and abs(duration - float(cand_dur)) > 25:
                return False
            dur_ok = dur_known and abs(duration - float(cand_dur)) <= 8
            if clean_artist:
                # REQUIRE the artist to corroborate. A tight duration match alone
                # is NOT enough — many different songs share a title + runtime
                # (an instrumental "Sky High" vs a vocal "Sky High"), and
                # accepting on duration showed the WRONG song's lyrics. No artist
                # match → no lyrics, which beats wrong lyrics.
                return _artist_score(item.get("artistName") or "") >= 55
            # No artist to verify against — lean on a strong title (+ duration).
            if dur_known:
                return title_score >= 80 and dur_ok
            return title_score >= 90

        # Collect every VALID synced candidate, then pick the one whose duration
        # is closest to the track we actually stream. lrclib often hosts several
        # uploads of the same song with slightly different masters/edits, and a
        # set of timestamps only lines up with audio of the SAME length. Taking
        # the first match (old behaviour) could grab a version 1-2s off, so the
        # highlight ran ahead or behind. Closest-duration = the tightest sync we
        # can get from the source.
        synced_candidates = []  # list of (duration_delta, result)

        def _consider(item):
            """Validate the item, then collect its synced lyrics (ranked later by
            duration closeness) or stash plain as a fallback."""
            if not _is_valid(item):
                return
            if item.get("instrumental"):
                return  # lrclib flags instrumentals — there are no lyrics to show
            synced = item.get("syncedLyrics") or ""
            plain = item.get("plainLyrics") or ""
            if synced:
                parsed = _parse_lrc(synced)
                if parsed:
                    cand_dur = item.get("duration") or 0
                    delta = (abs(duration - float(cand_dur))
                             if duration and cand_dur else 1e9)
                    synced_candidates.append(
                        (delta, {"plain": plain, "synced": parsed, "source": "lrclib"})
                    )
                    return
            if plain and plain_fallback["value"] is None:
                plain_fallback["value"] = {"plain": plain, "synced": [], "source": "lrclib"}

        def _best_synced():
            """The collected synced candidate closest in length to our stream."""
            if not synced_candidates:
                return None
            synced_candidates.sort(key=lambda x: x[0])
            return synced_candidates[0][1]

        # ── Strategy 1: Fuzzy search — one call returns many ranked candidates
        # we validate. Now that the connection is warm (startup warmup + pooled
        # session), this is fast AND robust: its queries cover multi-artist
        # tracks (e.g. "Zara Sa KK" finds a song credited "Sayeed Quadri, Pritam,
        # KK"), which a single-artist exact lookup can't. So it leads. ──
        search_queries = []
        if clean_artist:
            search_queries.append(f"{clean_title} {artist_candidates[-1]}".strip())
            search_queries.append(f"{clean_title} {clean_artist}".strip())
        search_queries.append(clean_title)
        seen_queries = set()
        for q in search_queries:
            if not q or q in seen_queries:
                continue
            if _time.monotonic() > _ll_deadline:
                break
            seen_queries.add(q)
            r = _http_get("https://lrclib.net/api/search",
                          params={"q": q}, headers=headers, timeout=8)
            if r is not None and r.status_code == 200:
                try:
                    items = r.json()
                except Exception:
                    items = None
                if isinstance(items, list):
                    # Collect all valid synced versions from this batch, then
                    # return the closest-duration one (best timing alignment).
                    for item in items[:15]:
                        _consider(item)
                    best = _best_synced()
                    if best:
                        return best

        # ── Strategy 2: Exact /api/get per artist candidate — precise fallback
        # for songs whose fuzzy-search ranking buries the right match. ──
        for art in artist_candidates[:4]:
            if _time.monotonic() > _ll_deadline:
                break
            r = _http_get("https://lrclib.net/api/get",
                          params={"track_name": clean_title, "artist_name": art},
                          headers=headers, timeout=8)
            if r is not None and r.status_code == 200:
                try:
                    _consider(r.json())
                except Exception:
                    pass
        best = _best_synced()
        if best:
            return best

        # ── No synced lyrics found anywhere — return plain fallback if we have one ──
        if plain_fallback["value"]:
            return plain_fallback["value"]

        # ── Strategy 3: JioSaavn plain lyrics fallback ────────────────────────
        # JioSaavn has good coverage for Indian/Bollywood/regional tracks.
        # Fast (one API call), returns HTML-formatted plain text (no timestamps).
        # Uses a direct request (not _http_get) so lrclib's deadline can't starve it.
        try:
            import urllib.parse as _ul
            _js_base = "https://www.jiosaavn.com/api.php"
            _js_headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://www.jiosaavn.com/",
                "Accept": "application/json",
            }

            def _js_get(params):
                url = f"{_js_base}?{_ul.urlencode({**params, '_format': 'json', '_marker': '0', 'ctx': 'web6dot0'})}"
                r = requests.get(url, headers=_js_headers, timeout=8)
                return r.json() if r.status_code == 200 else {}

            # Find song ID via autocomplete
            ac_data = _js_get({"__call": "autocomplete.get", "query": f"{clean_title} {clean_artist}".strip()})
            song_id = None
            for hit in (ac_data.get("songs", {}) or {}).get("data", [])[:5]:
                hit_title = _norm(hit.get("title", ""))
                if _sim(_norm(clean_title), hit_title) < 55:
                    continue
                # Verify the ARTIST too. Title-only matching returned a different
                # "Sky High" song's lyrics for our (instrumental) one. With no
                # artist corroboration we'd rather show nothing.
                if clean_artist:
                    mi = hit.get("more_info") or {}
                    hit_artist = mi.get("primary_artists") or mi.get("singers") or ""
                    if _artist_score(hit_artist) < 55:
                        continue
                song_id = hit.get("id")
                break

            if song_id:
                lyr_data = _js_get({"__call": "lyrics.getLyrics", "lyrics_id": song_id})
                raw_lyrics = lyr_data.get("lyrics", "")
                if raw_lyrics and len(raw_lyrics) > 20:
                    import re as _re2
                    plain = raw_lyrics.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
                    plain = _re2.sub(r"<[^>]+>", "", plain).strip()
                    if plain:
                        return {"plain": plain, "synced": [], "source": "jiosaavn"}
        except Exception:
            pass  # JioSaavn lyrics is best-effort; never block on failure

        return {"plain": "", "synced": [], "source": None}

    try:
        result = await asyncio.to_thread(_fetch)
        # Cache only real hits (has a source) so transient misses can retry later.
        if result and result.get("source"):
            with _lyrics_cache_lock:
                if len(_lyrics_cache) >= _LYRICS_CACHE_MAX:
                    _lyrics_cache.pop(next(iter(_lyrics_cache)))
                _lyrics_cache[cache_key] = result
        return result
    except Exception as e:
        return {"plain": "", "synced": [], "source": None, "error": str(e)}


@app.get("/api/sources/status")
async def sources_status():
    """Check status of all sources by probing client imports."""
    source_info = {
        "jiosaavn": {"type": "audio", "quality": "320kbps AAC"},
        "soundcloud": {"type": "audio", "quality": "256kbps MP3"},
        "youtube": {"type": "audio", "quality": "up to 256kbps MP3"},
        "itunes": {"type": "metadata", "quality": "30s preview"},
        "musicbrainz": {"type": "metadata", "quality": "ISRC/lookup"},
    }

    sources = {}
    for name, info in source_info.items():
        try:
            if name == "jiosaavn":
                from components.jiosaavn_downloader import JioSaavnClient  # noqa: F401
            elif name == "soundcloud":
                from components.soundcloud_downloader import SoundCloudClient  # noqa: F401
            elif name == "youtube":
                from components.youtube_downloader import YouTubeClient  # noqa: F401
            elif name == "itunes":
                from components.itunes_client import iTunesClient  # noqa: F401
            elif name == "musicbrainz":
                from components.musicbrainz_client import MusicBrainzClient  # noqa: F401
            sources[name] = {"status": "ready", **info}
        except ImportError as e:
            sources[name] = {"status": "unavailable", "error": str(e), **info}

    return {"sources": sources}


@app.get("/api/youtube/status")
async def youtube_status():
    """Whether the user has connected their YouTube account, by which method,
    and which browsers can be picked. Off by default."""
    method = "file" if _yt_cookiefile else ("browser" if _yt_browser else None)
    return {"connected": bool(_yt_browser or _yt_cookiefile), "method": method,
            "browser": _yt_browser, "browsers": sorted(YT_BROWSERS)}


_YT_TEST_VIDEO = "https://www.youtube.com/watch?v=jNQXAC9IVRw"  # "Me at the zoo"


class YouTubeConnectRequest(BaseModel):
    browser: str = Field(..., description="Browser to read YouTube cookies from")

    @field_validator("browser")
    @classmethod
    def _known_browser(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in YT_BROWSERS:
            raise ValueError(f"Unsupported browser: {v}")
        return v


@app.post("/api/youtube/connect")
async def youtube_connect(req: YouTubeConnectRequest):
    """Opt in to YouTube playback by reading the chosen browser's login cookies.
    Verifies the cookies actually resolve a known video before saving, so the
    user gets honest feedback instead of a silent failure at play time."""
    def _verify() -> bool:
        from components.youtube_downloader import YouTubeClient
        return bool(YouTubeClient(cookies_from_browser=req.browser).get_streaming_url(_YT_TEST_VIDEO, 128))

    try:
        ok = await asyncio.to_thread(_verify)
    except Exception as e:
        return {"connected": False, "error": f"Could not read {req.browser} cookies: {e}"}
    if not ok:
        return {"connected": False,
                "error": f"Couldn't stream a test video with {req.browser}'s cookies. "
                         "Make sure you're signed in to YouTube in that browser."}
    _set_youtube_browser(req.browser)
    _save_config({**_load_config(), "youtube_browser": req.browser, "youtube_cookiefile": None})
    return {"connected": True, "method": "browser", "browser": req.browser}


class YouTubeCookieFileRequest(BaseModel):
    content: str = Field(..., description="Netscape cookies.txt contents")


@app.post("/api/youtube/connect_file")
async def youtube_connect_file(req: YouTubeCookieFileRequest):
    """Opt in to YouTube playback by importing a cookies.txt exported from a
    signed-in YouTube session. The most robust method — no browser cookie
    decryption (which Chrome/Edge/Brave's App-Bound Encryption breaks on
    Windows). Validated, saved, then verified against a test video."""
    content = req.content or ""
    low = content.lower()
    # A Netscape cookie jar is tab-separated; YouTube cookies live on
    # .youtube.com / .google.com. Reject obviously-wrong files with a clear
    # message early (the stream test below is the real gate).
    if "\t" not in content or ("youtube.com" not in low and "google.com" not in low):
        return {"connected": False,
                "error": "That doesn't look like a YouTube cookies.txt. "
                         "Export it while signed in to YouTube."}
    path = _cookies_path()
    try:
        if not content.lstrip().startswith("# Netscape"):
            content = "# Netscape HTTP Cookie File\n" + content  # yt-dlp needs this header
        path.write_text(content, encoding="utf-8")
    except Exception as e:
        return {"connected": False, "error": f"Could not save cookies: {e}"}

    def _verify() -> bool:
        from components.youtube_downloader import YouTubeClient
        return bool(YouTubeClient(cookies_file=str(path)).get_streaming_url(_YT_TEST_VIDEO, 128))

    try:
        ok = await asyncio.to_thread(_verify)
    except Exception as e:
        _cookies_path().unlink(missing_ok=True)  # don't leave session tokens on a failed import
        return {"connected": False, "error": f"Cookies couldn't be used: {e}"}
    if not ok:
        _cookies_path().unlink(missing_ok=True)
        return {"connected": False,
                "error": "Those cookies didn't work — they may be expired. "
                         "Re-export from a signed-in YouTube tab."}
    _set_youtube_cookiefile(str(path))
    _save_config({**_load_config(), "youtube_cookiefile": str(path), "youtube_browser": None})
    return {"connected": True, "method": "file"}


@app.post("/api/youtube/disconnect")
async def youtube_disconnect():
    """Turn YouTube playback back off (revert to JioSaavn + SoundCloud only)."""
    _set_youtube_browser(None)
    _set_youtube_cookiefile(None)
    cfg = _load_config()
    cfg.pop("youtube_browser", None)
    cfg.pop("youtube_cookiefile", None)
    _save_config(cfg)
    try:
        _cookies_path().unlink(missing_ok=True)
    except Exception:
        pass
    return {"connected": False}


@app.get("/api/artwork")
async def get_artwork(
    title: str = Query(...),
    artist: str = Query(""),
):
    """Fetch artwork URL from iTunes for a given title+artist.
    Used to enrich tracks from sources that don't return cover art (SoundCloud, YouTube)."""
    try:
        loop = asyncio.get_event_loop()

        def _search_itunes():
            from components.itunes_client import iTunesClient
            client = iTunesClient()
            query = f"{title} {artist}".strip()
            results = client.search_tracks(query, limit=1)
            if results:
                t = results[0]
                d = t.to_dict()
                # Return the best artwork URL (600px)
                return d.get("artwork_600") or d.get("artwork_300") or d.get("artwork_100") or ""
            return ""

        artwork_url = await loop.run_in_executor(None, _search_itunes)
        return {"artwork_url": artwork_url}
    except Exception as e:
        return {"artwork_url": "", "error": str(e)}


class EnrichItem(BaseModel):
    title: str
    artist: str = ""
    isrc: Optional[str] = None
    duration_ms: Optional[int] = None


@app.get("/api/radio")
async def radio(
    title: str = Query(...),
    artist: str = Query(""),
    limit: int = Query(12),
):
    """Return ~12 similar playable tracks for autoplay/radio, seeded from a
    title+artist. See components/radio.py for the pipeline."""
    try:
        from components.radio import resolve_radio
        tracks = await asyncio.to_thread(resolve_radio, title, artist, min(max(limit, 1), 20))
        return {"tracks": tracks}
    except Exception as e:
        return {"tracks": [], "error": str(e)}


@app.get("/api/artist")
async def artist_profile(name: str = Query(...)):
    """Rich artist profile: image, bio, genre, listeners, top songs (playable),
    discography, and similar artists — assembled from JioSaavn + Last.fm +
    TheAudioDB + iTunes. See components/profile.py."""
    try:
        from components.profile import get_artist
        data = await asyncio.to_thread(get_artist, name)
        return data
    except Exception as e:
        return {"name": name, "top_songs": [], "albums": [], "error": str(e)}


@app.get("/api/search/artists")
async def search_artists_ep(q: str = Query(...), limit: int = Query(10)):
    """Real artists for the search page's Artists section (Deezer artist index),
    not track-artist grouping. See components/profile.search_artists."""
    try:
        from components.profile import search_artists
        return {"artists": await asyncio.to_thread(search_artists, q, limit)}
    except Exception as e:
        return {"artists": [], "error": str(e)}


@app.get("/api/album")
async def album_profile(name: str = Query(""), artist: str = Query(""),
                        song_url: str = Query(""), album_id: str = Query("")):
    """Album profile with a playable tracklist — JioSaavn-first, iTunes fallback
    (tracks resolved to playable). Identity priority: an explicit album_id (exact,
    from a search-result card) > song_url (a JioSaavn song page) > name+artist
    guessing. See components/profile.py."""
    try:
        from components.profile import get_album
        data = await asyncio.to_thread(get_album, name, artist, song_url, album_id)
        return data
    except Exception as e:
        return {"name": name, "artist": artist, "tracks": [], "error": str(e)}


@app.get("/api/search/albums")
async def search_albums_ep(q: str = Query(...), limit: int = Query(10)):
    """Real albums for the search page's Albums section (JioSaavn album search +
    iTunes), not track-album grouping. See components/profile.search_albums."""
    try:
        from components.profile import search_albums
        return {"albums": await asyncio.to_thread(search_albums, q, limit)}
    except Exception as e:
        return {"albums": [], "error": str(e)}


@app.get("/api/home")
async def home_feed(language: str = Query("hindi,english")):
    """Dynamic Home rows (trending, new releases, charts, top playlists) from
    JioSaavn's real homepage data. See components/home.py."""
    try:
        from components.home import get_home
        return await asyncio.to_thread(get_home, language)
    except Exception as e:
        return {"rows": [], "error": str(e)}


@app.get("/api/playlist")
async def playlist_detail(url: str = Query(...)):
    """Resolve a JioSaavn playlist/chart (by perma_url) to a playable,
    album-shaped tracklist. See components/home.py. A Spotify URL routes to the
    Spotify importer, so a saved Spotify playlist reopens like any other."""
    if "open.spotify.com" in url or url.startswith("spotify:"):
        return await spotify_import(url)
    try:
        from components.home import get_playlist
        return await asyncio.to_thread(get_playlist, url)
    except Exception as e:
        return {"name": "", "tracks": [], "error": str(e)}


@app.get("/api/spotify/import")
async def spotify_import(url: str = Query(...)):
    """Resolve a public Spotify playlist/album URL into playable tracks —
    same behaviour the mobile app has. Each Spotify (title, artist) is matched
    on JioSaavn/SoundCloud with a title+artist floor so a cover or a same-named
    wrong song is dropped (reported in `missing`) rather than played."""
    from components.spotify_import import parse_url, fetch_tracklist
    from components.fuzz_compat import fuzz

    kind, sid = parse_url(url)
    if not kind:
        return {"error": "Not a Spotify playlist or album link"}

    meta = await asyncio.to_thread(fetch_tracklist, kind, sid)
    if not meta:
        return {"error": "Could not read that playlist — is it public?"}

    def _norm(s):
        return re.sub(r"[^\w\s]", " ", (s or "").lower()).strip()

    def _ok(item, track):
        if fuzz.token_set_ratio(_norm(item["title"]), _norm(getattr(track, "title", ""))) < 82:
            return False
        cand = _norm(getattr(track, "artist", ""))
        for a in re.split(r"[,&/]| x |feat| ft ", _norm(item["artist"])):
            a = a.strip()
            if a and (a in cand or fuzz.partial_ratio(a, cand) >= 88):
                return True
        return False

    def _match(item):
        try:
            cfg = replace(
                _search_service.config,
                max_total_results=5,
                max_results_per_source=5,
                enabled_sources=PLAYABLE_SEARCH_SOURCES,
                timeout_seconds=10.0,
            )
            for track in _search_service.search(f"{item['title']} {item['artist']}".strip(), cfg):
                source = _playable_source_name(track)
                if not source or not _ok(item, track):
                    continue
                return {
                    "title": _clean_text(track.title) or item["title"],
                    "artist": _clean_text(track.artist) or item["artist"],
                    "album": _clean_text(track.album),
                    "duration_ms": track.duration_ms,
                    "isrc": track.isrc,
                    "sources": {k.value: _source_to_dict(v) for k, v in track.sources.items()},
                    "primary_source": source,
                    "playable_source": source,
                    "artwork_url": track.get_best_artwork() if hasattr(track, "get_best_artwork") else None,
                    "artwork_urls": _clean_artwork_urls(getattr(track, "artwork_urls", {})),
                    "is_playable": True,
                }
        except Exception:
            pass
        return None

    items = meta["tracks"][:100]

    def _match_all():
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=6) as ex:
            return list(ex.map(_match, items))

    matched = await asyncio.to_thread(_match_all)
    tracks = [t for t in matched if t]
    return {
        "name": meta["name"],
        "image": meta.get("image", ""),
        "tracks": tracks,
        "missing": [f"{i['title']} — {i['artist']}" for i, t in zip(items, matched) if not t],
        "total": len(items),
        "matched": len(tracks),
    }


@app.get("/api/genres")
async def genre_tiles(language: str = Query("hindi,english")):
    """Browse/genre tiles = JioSaavn curated featured playlists. Each tile is a
    playlist that resolves through /api/playlist. See components/home.py."""
    try:
        from components.home import get_genres
        return await asyncio.to_thread(get_genres, language)
    except Exception as e:
        return {"tiles": [], "error": str(e)}


class EnrichRequest(BaseModel):
    tracks: List[EnrichItem]


@app.post("/api/enrich")
async def enrich_batch(request: EnrichRequest):
    """Batch-enrich tracks with clean metadata (artist, album, artwork, release
    date, genre) from iTunes. Returns a list aligned with the input order; each
    entry is either an enrichment dict or null when no confident match is found.

    Called progressively by the frontend AFTER search results render, so search
    stays instant while metadata fills in a moment later."""
    if _enricher is None:
        return {"results": [None] * len(request.tracks)}

    def _do():
        from concurrent.futures import ThreadPoolExecutor

        def lookup_one(item):
            try:
                meta = _enricher._lookup(  # noqa: SLF001 (intentional internal use)
                    item.title or "",
                    item.artist or "",
                    item.isrc,
                    item.duration_ms,
                )
            except Exception:
                meta = None
            if meta:
                return {
                    "artist": _clean_text(meta.get("artist")) or None,
                    "album": _clean_text(meta.get("album")) or None,
                    "isrc": meta.get("isrc"),
                    "release_date": meta.get("release_date"),
                    "genre": meta.get("genre"),
                    "duration_ms": meta.get("duration_ms"),
                    "artwork": meta.get("artwork") or {},
                }
            return None

        with ThreadPoolExecutor(max_workers=6) as executor:
            # executor.map preserves input order. 6 workers + the client's
            # gentle rate limit balances speed vs iTunes 429s. Negative results
            # are cached so repeat searches are instant.
            return list(executor.map(lookup_one, request.tracks))

    try:
        results = await asyncio.to_thread(_do)
        return {"results": results}
    except Exception as e:
        return {"results": [None] * len(request.tracks), "error": str(e)}


@app.get("/api/proxy_stream")
async def proxy_stream(
    request: Request,
    url: str = Query(...),
    source: str = Query(...),
    bitrate: int = Query(320),
):
    """Proxy audio stream to avoid CORS issues in the browser.
    Supports Range requests so the HTML5 <audio> seek bar works."""
    try:
        # JioSaavn doesn't have every track in every bitrate — the 320 file may
        # 404 while 160/96 exist. Build a descending fallback ladder from the
        # requested bitrate so playback is robust.
        if source == "jiosaavn":
            bitrate_ladder = [b for b in (bitrate, 320, 160, 96)
                              if b <= bitrate]
            # de-dupe preserving order
            seen, ladder2 = set(), []
            for b in bitrate_ladder:
                if b not in seen:
                    seen.add(b)
                    ladder2.append(b)
            bitrate_ladder = ladder2 or [bitrate]
        else:
            bitrate_ladder = [bitrate]

        range_header = request.headers.get("range", "bytes=0-")

        def resolve_and_fetch(br):
            """Resolve a stream URL at bitrate `br` and open the upstream.
            Returns (response, None) on success or (None, status) when the
            upstream rejects it (e.g. 404/403) so the caller can try lower."""
            s_url = _resolve_stream_url(url, source, br)
            if not s_url:
                return None, None
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "*/*",
                "Range": range_header,
            }
            if source == "jiosaavn":
                headers["Referer"] = "https://www.jiosaavn.com/"
            r = http_requests.get(s_url, headers=headers, stream=True, timeout=30)
            if r.status_code in (403, 404, 410, 500, 502, 503):
                r.close()
                return None, r.status_code
            return r, None

        def fetch_with_fallback():
            last_status = None
            for br in bitrate_ladder:
                resp, status = resolve_and_fetch(br)
                if resp is not None:
                    return resp
                last_status = status
            return None if last_status is None else last_status

        upstream = await asyncio.to_thread(fetch_with_fallback)

        if upstream is None or isinstance(upstream, int):
            detail = (
                f"Stream unavailable (upstream status {upstream})"
                if isinstance(upstream, int) else "Could not resolve streaming URL"
            )
            raise HTTPException(status_code=502, detail=detail)

        # Read content-type from upstream instead of guessing
        content_type = upstream.headers.get("content-type", "audio/mp4")

        # Build response headers
        resp_headers = {
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
        }
        # Forward Content-Range for 206 responses (seek support)
        if upstream.status_code == 206:
            cr = upstream.headers.get("content-range")
            if cr:
                resp_headers["Content-Range"] = cr
        cl = upstream.headers.get("content-length")
        if cl:
            resp_headers["Content-Length"] = cl

        def stream_chunks():
            try:
                for chunk in upstream.iter_content(chunk_size=8192):
                    if chunk:
                        yield chunk
            finally:
                upstream.close()

        return StreamingResponse(
            stream_chunks(),
            status_code=upstream.status_code,  # 200 or 206
            media_type=content_type,
            headers=resp_headers,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    import argparse

    parser = argparse.ArgumentParser(description="Fix_Spotify API Server")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")
    args, _ = parser.parse_known_args()

    uvicorn.run(app, host=args.host, port=args.port)
