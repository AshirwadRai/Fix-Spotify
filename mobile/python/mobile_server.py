"""
Fix_Spotify — on-device backend (Android / Chaquopy)
====================================================
A Flask port of api/main.py that runs INSIDE the APK.

Why Flask and not FastAPI
-------------------------
FastAPI depends on pydantic v2, whose `pydantic-core` is a compiled Rust
extension with no Android wheel. Flask + Werkzeug are pure Python, so Chaquopy
installs them straight from PyPI. Every route below keeps the EXACT request and
response shape of api/main.py, so frontend/src/api.js works unmodified.

Why the phone and not a server
------------------------------
JioSaavn geo-gates to India and YouTube bot-blocks datacenter IPs. Running the
backend on the handset means every outbound request carries the user's own
carrier/residential IP — the same IP the desktop app used. No proxies, no
hosting, no blocking.

Same-origin by design
---------------------
This server ALSO serves the React SPA. The WebView loads http://127.0.0.1:8765/,
so the app and the API share an origin: `apiUrl()` stays relative, CORS is moot,
and <audio src="/api/proxy_stream?..."> streams and seeks natively.

What is NOT here (vs. the desktop backend)
------------------------------------------
* YouTube    — needs Deno to solve the JS n-signature challenge; there is no
               Deno for Android. Disabled at the client factory (see below), so
               no YouTube result can ever reach the UI as an unplayable track.
* ffprobe    — /api/stream_info reported the true bitrate by shelling out to
               ffprobe. No ffmpeg on Android, so we report the bitrate the
               source advertises instead of probing the bytes.
"""

import hmac
import io
import json
import os
import re
import sys
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, is_dataclass, replace
from html import unescape
from pathlib import Path
from typing import Any, Dict, List, Optional

import android_env

import requests as http_requests
from requests.adapters import HTTPAdapter
from flask import Flask, Response, jsonify, request, send_file, send_from_directory
from werkzeug.serving import make_server

# On Android, Gradle's `syncPythonSources` task copies components/ next to this
# file, so it is importable straight off Chaquopy's sys.path.
#
# On a desktop test run (`python mobile_server.py`) it is not — the real
# components/ lives two directories up. Add the repo root BEFORE the imports
# below, not in __main__, which would run far too late.
if not (Path(__file__).parent / "components").is_dir():
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from components.unified_search import UnifiedSearchService
from components.source_merger import SourceType
from components.download_manager import DownloadManager, DownloadQueueConfig
from components.metadata_enricher import MetadataEnricher


# ──────────────────────────────────────────────────────────────────────────────
# YouTube kill-switch
# ──────────────────────────────────────────────────────────────────────────────
# components/ is vendored verbatim, and two places still ask for a YouTube
# client: unified_search's default `enabled_sources`, and profile.py's
# _fallback_search_service(), which hardcodes SourceType.YOUTUBE into a set
# literal we cannot override with config.
#
# Rather than fork those files, we neuter the one funnel they both go through.
# UnifiedSearchService._search_source() bails out with [] when _get_client()
# returns None, so refusing to build a YouTube client disables YouTube
# EVERYWHERE — search, radio, artist pages, album fallbacks — with one hook and
# zero edits to components/.
_DISABLED_SOURCES = {SourceType.YOUTUBE, SourceType.YOUTUBE_MUSIC}
_original_get_client = UnifiedSearchService._get_client


def _get_client_no_youtube(self, source_type):
    if source_type in _DISABLED_SOURCES:
        return None
    return _original_get_client(self, source_type)


UnifiedSearchService._get_client = _get_client_no_youtube

# The sources a mobile search actually queries. iTunes/MusicBrainz are
# metadata-only (no stream URL) and would just slow the response down; clean
# metadata still arrives progressively through /api/enrich.
PLAYABLE_SEARCH_SOURCES = {SourceType.JIOSAAVN, SourceType.SOUNDCLOUD}
PLAYABLE_SOURCES = {"jiosaavn", "soundcloud"}


# ──────────────────────────────────────────────────────────────────────────────
# Globals
# ──────────────────────────────────────────────────────────────────────────────
_search_service: Optional[UnifiedSearchService] = None
_download_manager: Optional[DownloadManager] = None
_enricher: Optional[MetadataEnricher] = None
_server = None

_lyrics_cache: Dict[str, Dict[str, Any]] = {}
_lyrics_cache_lock = threading.Lock()
_LYRICS_CACHE_MAX = 1000


def _build_lyrics_session() -> http_requests.Session:
    """Pooled session for lrclib. Mobile networks make a cold TLS handshake even
    more expensive than on desktop, so connection reuse matters more here."""
    s = http_requests.Session()
    try:
        from urllib3.util.retry import Retry
        retry = Retry(total=1, connect=1, read=0, status=0, backoff_factor=0.2,
                      allowed_methods=frozenset(["GET"]))
        adapter = HTTPAdapter(max_retries=retry, pool_connections=4, pool_maxsize=8)
        s.mount("https://", adapter)
        s.mount("http://", adapter)
    except Exception:
        pass
    return s


_lyrics_session = _build_lyrics_session()


def get_default_download_dir() -> str:
    """The user's custom folder if set, else Downloads/Fix_Spotify/music, else
    the app-private dir. See android_env.downloads_dir() for why."""
    return android_env.downloads_dir()


# ──────────────────────────────────────────────────────────────────────────────
# Helpers (ported verbatim from api/main.py)
# ──────────────────────────────────────────────────────────────────────────────
def _clean_text(value: Optional[str]) -> Optional[str]:
    """Decode API/entity noise before it reaches the UI."""
    if value is None:
        return None
    cleaned = unescape(str(value))
    replacements = {
        "Â·": "·",
        "â€™": "'",
        "â€œ": '"',
        "â€": '"',
        "â€“": "-",
        "â€”": "-",
    }
    for bad, good in replacements.items():
        cleaned = cleaned.replace(bad, good)
    cleaned = cleaned.replace("Â·", "·")
    return " ".join(cleaned.split())


def _finalize_track_info(info: Dict[str, Any]) -> Dict[str, Any]:
    """FINAL clean metadata embedded into every downloaded file, regardless of
    which screen triggered the download. JioSaavn metadata is authoritative for
    its own catalog, so for a JioSaavn track we gap-fill only; artwork/genre/
    date/isrc always overlay (pure gain)."""
    if not isinstance(info, dict):
        return info
    out = dict(info)
    src = info.get("sources") if isinstance(info.get("sources"), dict) else {}
    from_jiosaavn = bool((src.get("jiosaavn") or {}).get("url")) \
        or info.get("playable_source") == "jiosaavn" \
        or info.get("primary_source") == "jiosaavn"
    try:
        meta = _enricher._lookup(
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
        primary_data = _source_to_dict(getattr(track, "sources", {}).get(primary))
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
    """Resolve a source page URL into a direct, playable stream URL.
    YouTube is intentionally absent — it cannot be resolved without a JS runtime."""
    if source == "jiosaavn":
        from components.jiosaavn_downloader import JioSaavnClient
        # JioSaavn serves discrete bitrates only: 320 / 160 / 96.
        js_bitrate = 320 if bitrate >= 320 else (160 if bitrate >= 160 else 96)
        return JioSaavnClient().get_streaming_url(url, js_bitrate)
    if source == "soundcloud":
        from components.soundcloud_downloader import SoundCloudClient
        return SoundCloudClient().get_streaming_url(url, bitrate)
    return None


def _parse_lrc(synced: str):
    """Parse an LRC synced-lyrics string into [{time, text}] sorted by time."""
    lines = []
    for raw in (synced or "").splitlines():
        stamps = re.findall(r"\[(\d+):(\d+(?:\.\d+)?)\]", raw)
        text = re.sub(r"\[\d+:\d+(?:\.\d+)?\]", "", raw).strip()
        for m, s in stamps:
            t = int(m) * 60 + float(s)
            lines.append({"time": round(t, 2), "text": text})
    lines.sort(key=lambda x: x["time"])
    return lines


def _arg(name: str, default: str = "") -> str:
    return (request.args.get(name) or default).strip()


def _int_arg(name: str, default: int = 0) -> int:
    try:
        return int(request.args.get(name, default))
    except (TypeError, ValueError):
        return default


def _body() -> Dict[str, Any]:
    return request.get_json(silent=True) or {}


# ──────────────────────────────────────────────────────────────────────────────
# App
# ──────────────────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=None)

# Set by start_server() from Kotlin. Empty on a desktop test run, which disables
# the check below so `python mobile_server.py` still works.
_API_TOKEN = ""


@app.before_request
def _require_token():
    """Gate /api/* on the per-launch token.

    Loopback is NOT a security boundary on Android: every other app on the phone
    can reach 127.0.0.1:8765. Unguarded, any installed app could drive this
    server — enqueue downloads, read the local library, or (now that the app can
    hold All-files access) repoint downloads at an arbitrary path via
    /api/downloads/dir.

    Only /api/* is gated. The SPA's own HTML/JS/CSS stay open because they are
    just our static assets and carry no secret — in particular the token is NOT
    in them; it reaches the page over the Kotlin JS bridge instead.

    The token rides in the query string rather than a header because <audio
    src="/api/proxy_stream?..."> cannot set headers, and it must be authorised
    like everything else.
    """
    if not _API_TOKEN:
        return None                                  # desktop test run
    if not request.path.startswith("/api/"):
        return None                                  # SPA assets
    if request.method == "OPTIONS":
        return None                                  # CORS preflight

    supplied = request.args.get("_t") or request.headers.get("X-Fix-Token") or ""
    # compare_digest: constant-time, so a caller can't time-probe the token.
    if not hmac.compare_digest(supplied, _API_TOKEN):
        return jsonify({"error": "forbidden"}), 403
    return None


@app.after_request
def _cors(resp):
    # Same-origin in the WebView, so this is belt-and-braces — it also lets you
    # point a desktop browser at http://127.0.0.1:8765 over `adb forward` while
    # debugging the UI.
    resp.headers.setdefault("Access-Control-Allow-Origin", "*")
    resp.headers.setdefault("Access-Control-Allow-Headers", "*")
    resp.headers.setdefault("Access-Control-Allow-Methods", "*")
    return resp


@app.get("/health")
def health():
    return jsonify({"status": "healthy"})


@app.get("/api/connectivity")
def connectivity():
    """Distinguishes 'offline' from 'no results' for the UI's offline banner."""
    for url in ("https://www.google.com", "https://1.1.1.1"):
        try:
            http_requests.head(url, timeout=4, allow_redirects=False)
            return jsonify({"online": True})
        except Exception:
            continue
    return jsonify({"online": False})


# ─── Search ───────────────────────────────────────────────────────────────────
@app.post("/api/search")
def search_tracks():
    body = _body()
    query = (body.get("query") or "").strip()
    if not query:
        return jsonify({"results": [], "total": 0, "query": ""})
    limit = max(1, min(int(body.get("limit") or 20), 100))

    if _search_service is None:
        return jsonify({"error": "Search service not ready"}), 503

    try:
        # Per-request config copy — /api/search and /api/search/suggestions share
        # one service, and suggestions fire on every keystroke. replace() keeps
        # them from racing each other on the shared config object.
        req_config = replace(
            _search_service.config,
            max_total_results=limit,
            enabled_sources=PLAYABLE_SEARCH_SOURCES,
            timeout_seconds=12.0,
        )
        results = _search_service.search(query, req_config)

        out = []
        for track in results:
            playable_source = _playable_source_name(track)
            if not playable_source:
                continue
            out.append({
                "title": _clean_text(track.title) or "",
                "artist": _clean_text(track.artist) or "",
                "album": _clean_text(track.album),
                "duration_ms": track.duration_ms,
                "isrc": track.isrc,
                "sources": {k.value: _source_to_dict(v) for k, v in track.sources.items()},
                "primary_source": playable_source,
                "search_score": track.search_score,
                "artwork_url": track.get_best_artwork() if hasattr(track, "get_best_artwork") else None,
                "artwork_urls": _clean_artwork_urls(getattr(track, "artwork_urls", {})),
                "is_playable": True,
                "playable_source": playable_source,
            })

        return jsonify({"results": out, "total": len(out), "query": query})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/api/search/suggestions")
def search_suggestions():
    q = _arg("q")
    limit = min(max(_int_arg("limit", 8), 1), 20)
    if len(q) < 2 or _search_service is None:
        return jsonify({"suggestions": []})

    try:
        # Suggestions must be CHEAP — they fire on every debounced keystroke.
        # JioSaavn only: it has the fastest autocomplete-grade index.
        req_config = replace(
            _search_service.config,
            max_total_results=limit,
            enabled_sources={SourceType.JIOSAAVN},
            max_results_per_source=limit,
            timeout_seconds=6.0,
        )
        results = _search_service.search(q, req_config)

        seen, suggestions = set(), []
        for track in results:
            key = f"{track.title.lower()}|{track.artist.lower()}"
            if key in seen:
                continue
            seen.add(key)
            suggestions.append({
                "title": track.title,
                "artist": track.artist,
                "album": track.album,
                "sources": [s.value for s in track.sources.keys()],
                "isrc": track.isrc,
            })
            if len(suggestions) >= limit:
                break
        return jsonify({"suggestions": suggestions})
    except Exception:
        return jsonify({"suggestions": []})


# ─── Streaming ────────────────────────────────────────────────────────────────
@app.post("/api/stream_url")
def get_stream_url():
    body = _body()
    url, source = body.get("url") or "", body.get("source") or ""
    try:
        stream_url = _resolve_stream_url(url, source, 320)
        if stream_url:
            return jsonify({"stream_url": stream_url})
        return jsonify({
            "stream_url": None,
            "error": f"Could not extract streaming URL for source: {source}",
        })
    except Exception as e:
        return jsonify({"stream_url": None, "error": str(e)}), 500


@app.get("/api/stream_info")
def stream_info():
    """Live quality readout for the player.

    The desktop build shelled out to ffprobe to read the true bitrate off the
    wire. Android has no ffmpeg, so we report what the source advertises. For
    JioSaavn that IS the real value (we request a specific bitrate and it serves
    that exact file); SoundCloud transcodes are ~128k MP3.
    """
    source = _arg("source")
    bitrate = _int_arg("bitrate", 320)
    try:
        stream_url = _resolve_stream_url(_arg("url"), source, bitrate)
        if not stream_url:
            return jsonify({"bitrate_kbps": None, "codec": None,
                            "error": "Could not resolve stream"})
        if source == "jiosaavn":
            served = 320 if bitrate >= 320 else (160 if bitrate >= 160 else 96)
            return jsonify({"bitrate_kbps": served, "codec": "aac"})
        if source == "soundcloud":
            codec = "mp3" if ".mp3" in stream_url or "mp3" in stream_url else "opus"
            return jsonify({"bitrate_kbps": 128, "codec": codec})
        return jsonify({"bitrate_kbps": None, "codec": None})
    except Exception as e:
        return jsonify({"bitrate_kbps": None, "codec": None, "error": str(e)})


@app.get("/api/proxy_stream")
def proxy_stream():
    """Stream audio through the local server so <audio> can play and SEEK it.

    Forwards the browser's Range header upstream and mirrors the 206 +
    Content-Range back, which is what makes the seek bar work.
    """
    url, source = _arg("url"), _arg("source")
    bitrate = _int_arg("bitrate", 320)

    # JioSaavn doesn't hold every track at every bitrate — a 320 file may 404
    # while 160/96 exist. Walk down from what was asked for.
    if source == "jiosaavn":
        ladder, seen = [], set()
        for b in (bitrate, 320, 160, 96):
            if b <= bitrate and b not in seen:
                seen.add(b)
                ladder.append(b)
        ladder = ladder or [bitrate]
    else:
        ladder = [bitrate]

    range_header = request.headers.get("Range", "bytes=0-")

    def resolve_and_fetch(br):
        s_url = _resolve_stream_url(url, source, br)
        if not s_url:
            return None, None
        headers = {
            "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
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

    upstream, last_status = None, None
    try:
        for br in ladder:
            upstream, last_status = resolve_and_fetch(br)
            if upstream is not None:
                break
    except Exception as e:
        return jsonify({"detail": str(e)}), 500

    if upstream is None:
        detail = (f"Stream unavailable (upstream status {last_status})"
                  if last_status else "Could not resolve streaming URL")
        return jsonify({"detail": detail}), 502

    resp_headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-cache"}
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

    return Response(
        stream_chunks(),
        status=upstream.status_code,  # 200 or 206
        mimetype=upstream.headers.get("content-type", "audio/mp4"),
        headers=resp_headers,
        direct_passthrough=True,
    )


# ─── Downloads ────────────────────────────────────────────────────────────────
@app.post("/api/download")
def download_track():
    if not _download_manager:
        return jsonify({"detail": "Download manager not initialized"}), 500
    body = _body()
    url = (body.get("url") or "").strip()
    if not url:
        return jsonify({"detail": "URL must not be empty"}), 400

    track_info = body.get("track_info") or {}
    max_bitrate = max(64, min(int(body.get("max_bitrate") or 256), 320))

    # Android has no user-chosen output folder (scoped storage), so `output_dir`
    # from the frontend is ignored and everything lands in the app's Music dir.
    out_dir_path = Path(get_default_download_dir())
    try:
        out_dir_path.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    safe_title = re.sub(r'[<>:"/\\|?*]', "_", track_info.get("title", "unknown")).strip() or "unknown"
    safe_artist = re.sub(r'[<>:"/\\|?*]', "_", track_info.get("artist", "unknown")).strip() or "unknown"
    output_path = str(out_dir_path / f"{safe_title} - {safe_artist}")

    try:
        task_id = _download_manager.add_download(
            url=url,
            track_info=track_info,
            output_path=output_path,
            max_bitrate=max_bitrate,
        )
        return jsonify({"task_id": task_id, "status": "queued",
                        "message": "Download started in background"})
    except Exception as e:
        return jsonify({"detail": str(e)}), 500


@app.get("/api/download/<task_id>")
def get_download_status(task_id):
    if not _download_manager:
        return jsonify({"detail": "Download manager not initialized"}), 500
    task = _download_manager.get_task(task_id)
    if not task:
        return jsonify({"detail": "Task not found"}), 404
    return jsonify({
        "task_id": task.id,
        "status": task.status.value,
        "progress": task.progress,
        "downloaded_bytes": task.downloaded_bytes,
        "total_bytes": task.total_bytes,
        "file_path": task.file_path,
        "error": task.error,
    })


@app.get("/api/downloads")
def list_downloads():
    if not _download_manager:
        return jsonify({"tasks": []})
    tasks = _download_manager.get_all_tasks()
    tasks.sort(key=lambda t: t.created_at, reverse=True)
    return jsonify({"tasks": [t.to_dict() for t in tasks]})


@app.get("/api/downloads/info")
def downloads_info():
    # `download_dir` stays for the existing frontend contract; the rest tells the
    # Settings screen whether we actually landed in the folder the user asked for.
    return jsonify({
        "download_dir": get_default_download_dir(),
        **android_env.downloads_status(),
    })


@app.post("/api/downloads/dir")
def set_downloads_dir():
    """Choose a custom download folder (or clear it, restoring the default).

    Refuses a folder we cannot actually write to, rather than accepting it and
    letting every later download fail with no explanation.
    """
    path = (_body().get("path") or "").strip()

    settings = android_env.read_settings()
    if not path:
        settings.pop("download_dir", None)
        android_env.write_settings(settings)
        return jsonify({"ok": True, **android_env.downloads_status()})

    if not android_env.is_writable(path):
        return jsonify({
            "ok": False,
            "error": "Can't write to that folder. Grant “All files access” in "
                     "Android Settings, or pick a different folder.",
        }), 400

    settings["download_dir"] = path
    android_env.write_settings(settings)
    return jsonify({"ok": True, **android_env.downloads_status()})


@app.get("/api/downloads/local")
def scan_local_downloads():
    """Rebuild the offline library from the tags embedded in each file on disk.
    Disk is the source of truth, so downloads survive a cleared frontend registry
    or an app restart."""
    from components.download_manager import scan_downloads
    directory = get_default_download_dir()
    try:
        tracks = scan_downloads(directory)
    except Exception:
        tracks = []
    return jsonify({"tracks": tracks, "download_dir": directory})


@app.post("/api/download/<task_id>/cancel")
def cancel_download(task_id):
    if not _download_manager:
        return jsonify({"cancelled": False})
    return jsonify({"cancelled": _download_manager.cancel_task(task_id)})


@app.post("/api/download/<task_id>/retry")
def retry_download(task_id):
    if not _download_manager:
        return jsonify({"retried": False})
    return jsonify({"retried": _download_manager.retry_task(task_id)})


@app.post("/api/downloads/clear")
def clear_completed_downloads():
    if not _download_manager:
        return jsonify({"cleared": 0})
    return jsonify({"cleared": _download_manager.clear_completed()})


_LOCAL_AUDIO_EXTS = {".m4a", ".mp3", ".flac", ".opus", ".ogg", ".wav", ".aac", ".mp4"}


@app.get("/api/local")
def serve_local_file():
    """Serve a downloaded file for offline playback.

    Confined to the downloads directory and to audio extensions. The path comes
    from our own records, but it arrives over HTTP from the WebView, so it is
    still treated as untrusted input.
    """
    path = request.args.get("path") or ""
    try:
        real = Path(path).expanduser().resolve(strict=True)
    except Exception:
        return jsonify({"detail": "File not found"}), 404

    root = Path(get_default_download_dir()).resolve()
    if root not in real.parents:
        return jsonify({"detail": "Path not allowed"}), 403
    if real.suffix.lower() not in _LOCAL_AUDIO_EXTS:
        return jsonify({"detail": "Unsupported file type"}), 403
    if not real.is_file():
        return jsonify({"detail": "File not found"}), 404

    # conditional=True gives us Range/206 handling, so seeking works offline.
    return send_file(str(real), conditional=True)


# ─── Lyrics ───────────────────────────────────────────────────────────────────
@app.get("/api/lyrics")
def get_lyrics():
    """Synced lyrics from lrclib, with a JioSaavn plain-text fallback.

    The matching gate is the important part: lrclib's fuzzy search happily
    returns a DIFFERENT song that merely shares a title. Wrong lyrics are worse
    than no lyrics, so a candidate must clear an artist + duration confidence
    check before we accept it.
    """
    title = _arg("title")
    artist = _arg("artist")
    duration = _int_arg("duration", 0)

    cache_key = f"{title.lower()}|{artist.lower()}"
    with _lyrics_cache_lock:
        hit = _lyrics_cache.get(cache_key)
    if hit is not None:
        return jsonify(hit)

    def _clean_for_search(text: str) -> str:
        cleaned = re.sub(r'\s*[\(\[\{].*?[\)\]\}]', '', text)
        cleaned = re.sub(r'\s*[-|].*(?:official|video|audio|lyric|full|hd|4k|visuali).*$',
                         '', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'\s+(?:feat\.|ft\.).*$', '', cleaned, flags=re.IGNORECASE)
        return cleaned.strip()

    def _fetch():
        headers = {"User-Agent": "Fix_Spotify/1.0 (music player)"}
        clean_title = _clean_for_search(title)
        clean_artist = _clean_for_search(artist)

        # A total miss can otherwise stack many slow calls; on a mobile network
        # those add up fast. Bound the whole lookup.
        start = time.monotonic()
        deadline = start + 20      # hard cap for the entire lookup
        ll_deadline = start + 12   # favour lrclib (our only SYNCED source)

        def _http_get(url, *, timeout, **kw):
            left = deadline - time.monotonic()
            if left < 1.5:
                return None
            try:
                return _lyrics_session.get(url, timeout=min(timeout, left), **kw)
            except Exception:
                return None

        # Indian tracks often arrive credited as "Lyricist, Composer, Singer"
        # ("Sayeed Quadri, Pritam, KK") but lrclib indexes ONE artist name, so we
        # try each component separately.
        artist_candidates = []
        if clean_artist:
            artist_candidates.append(clean_artist)
            for sep in (",", "&", "feat.", "ft.", " x ", "/"):
                if sep in clean_artist.lower():
                    for part in re.split(r'[,&/]| feat\.| ft\.| x ', clean_artist,
                                         flags=re.IGNORECASE):
                        part = part.strip()
                        if part and part not in artist_candidates:
                            artist_candidates.append(part)
                    break
        if not artist_candidates:
            artist_candidates = [""]

        plain_fallback = {"value": None}

        # rapidfuzz has no Android wheel, so this always takes the difflib branch
        # on-device. Kept identical to the desktop code so behaviour matches when
        # rapidfuzz IS importable (e.g. running this file on a PC).
        try:
            from rapidfuzz import fuzz as _fuzz

            def _sim(a, b):
                return max(_fuzz.token_set_ratio(a, b), _fuzz.partial_ratio(a, b))

            def _artist_cmp(a, b):
                # No partial_ratio here: it spuriously matches long multi-artist
                # credit strings.
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
            s = re.sub(r"[^\w\s]", " ", (s or "").lower())
            return re.sub(r"\s+", " ", s).strip()

        def _artist_score(cand_artist):
            if not clean_artist or not cand_artist:
                return 0.0
            cand = _norm(cand_artist)
            best = _artist_cmp(_norm(clean_artist), cand)
            for part in re.split(r'[,&/]| feat\.| ft\.| x ', clean_artist, flags=re.IGNORECASE):
                part = part.strip()
                if len(part) >= 2:
                    best = max(best, _artist_cmp(_norm(part), cand))
            return best

        def _is_valid(item):
            title_score = _sim(_norm(clean_title), _norm(item.get("trackName") or ""))
            if title_score < 65:
                return False
            cand_dur = item.get("duration") or 0
            dur_known = bool(duration and duration > 0 and cand_dur)
            # Same title, far-off length = a different recording. Hard veto.
            if dur_known and abs(duration - float(cand_dur)) > 25:
                return False
            dur_ok = dur_known and abs(duration - float(cand_dur)) <= 8
            if clean_artist:
                # A tight duration match alone is NOT enough — different songs
                # share a title AND a runtime. Require artist corroboration.
                return _artist_score(item.get("artistName") or "") >= 55
            if dur_known:
                return title_score >= 80 and dur_ok
            return title_score >= 90

        # lrclib often hosts several uploads of one song with slightly different
        # masters. A set of timestamps only lines up with audio of the SAME
        # length, so collect every valid synced hit and take the closest duration.
        synced_candidates = []

        def _consider(item):
            if not _is_valid(item) or item.get("instrumental"):
                return
            synced = item.get("syncedLyrics") or ""
            plain = item.get("plainLyrics") or ""
            if synced:
                parsed = _parse_lrc(synced)
                if parsed:
                    cand_dur = item.get("duration") or 0
                    delta = abs(duration - float(cand_dur)) if duration and cand_dur else 1e9
                    synced_candidates.append(
                        (delta, {"plain": plain, "synced": parsed, "source": "lrclib"})
                    )
                    return
            if plain and plain_fallback["value"] is None:
                plain_fallback["value"] = {"plain": plain, "synced": [], "source": "lrclib"}

        def _best_synced():
            if not synced_candidates:
                return None
            synced_candidates.sort(key=lambda x: x[0])
            return synced_candidates[0][1]

        # Strategy 1 — fuzzy search: one call returns many ranked candidates, and
        # its queries cover multi-artist credits a single exact lookup can't.
        search_queries = []
        if clean_artist:
            search_queries.append(f"{clean_title} {artist_candidates[-1]}".strip())
            search_queries.append(f"{clean_title} {clean_artist}".strip())
        search_queries.append(clean_title)

        seen_queries = set()
        for q in search_queries:
            if not q or q in seen_queries or time.monotonic() > ll_deadline:
                continue
            seen_queries.add(q)
            r = _http_get("https://lrclib.net/api/search",
                          params={"q": q}, headers=headers, timeout=8)
            if r is not None and r.status_code == 200:
                try:
                    items = r.json()
                except Exception:
                    items = None
                if isinstance(items, list):
                    for item in items[:15]:
                        _consider(item)
                    best = _best_synced()
                    if best:
                        return best

        # Strategy 2 — exact /api/get per artist candidate, for songs whose fuzzy
        # ranking buries the right match.
        for art in artist_candidates[:4]:
            if time.monotonic() > ll_deadline:
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

        if plain_fallback["value"]:
            return plain_fallback["value"]

        # Strategy 3 — JioSaavn plain lyrics. Strong coverage for Indian/
        # Bollywood/regional tracks. Direct request so lrclib's deadline can't
        # starve it.
        try:
            js_base = "https://www.jiosaavn.com/api.php"
            js_headers = {
                "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
                "Referer": "https://www.jiosaavn.com/",
                "Accept": "application/json",
            }

            def _js_get(params):
                qs = urllib.parse.urlencode(
                    {**params, "_format": "json", "_marker": "0", "ctx": "web6dot0"}
                )
                r = http_requests.get(f"{js_base}?{qs}", headers=js_headers, timeout=8)
                return r.json() if r.status_code == 200 else {}

            ac_data = _js_get({"__call": "autocomplete.get",
                               "query": f"{clean_title} {clean_artist}".strip()})
            song_id = None
            for hit in (ac_data.get("songs", {}) or {}).get("data", [])[:5]:
                if _sim(_norm(clean_title), _norm(hit.get("title", ""))) < 55:
                    continue
                # Verify the ARTIST too — title-only matching served a different
                # song's lyrics. With no corroboration we'd rather show nothing.
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
                    plain = (raw_lyrics.replace("<br>", "\n")
                                       .replace("<br/>", "\n")
                                       .replace("<br />", "\n"))
                    plain = re.sub(r"<[^>]+>", "", plain).strip()
                    if plain:
                        return {"plain": plain, "synced": [], "source": "jiosaavn"}
        except Exception:
            pass  # best-effort; never block on failure

        return {"plain": "", "synced": [], "source": None}

    try:
        result = _fetch()
        # Cache only real hits, so a transient miss can retry later.
        if result and result.get("source"):
            with _lyrics_cache_lock:
                if len(_lyrics_cache) >= _LYRICS_CACHE_MAX:
                    _lyrics_cache.pop(next(iter(_lyrics_cache)))
                _lyrics_cache[cache_key] = result
        return jsonify(result)
    except Exception as e:
        return jsonify({"plain": "", "synced": [], "source": None, "error": str(e)})


# ─── Discovery / profiles ─────────────────────────────────────────────────────
@app.get("/api/artwork")
def get_artwork():
    try:
        from components.itunes_client import iTunesClient
        results = iTunesClient().search(f"{_arg('title')} {_arg('artist')}".strip(), limit=1)
        if results:
            art = getattr(results[0], "artwork_urls", {}) or {}
            return jsonify({"artwork_url": art.get("600") or art.get("300") or ""})
        return jsonify({"artwork_url": ""})
    except Exception as e:
        return jsonify({"artwork_url": "", "error": str(e)})


@app.get("/api/radio")
def radio():
    try:
        from components.radio import resolve_radio
        limit = min(max(_int_arg("limit", 12), 1), 20)
        return jsonify({"tracks": resolve_radio(_arg("title"), _arg("artist"), limit)})
    except Exception as e:
        return jsonify({"tracks": [], "error": str(e)})


@app.get("/api/artist")
def artist_profile():
    name = _arg("name")
    try:
        from components.profile import get_artist
        return jsonify(get_artist(name))
    except Exception as e:
        return jsonify({"name": name, "top_songs": [], "albums": [], "error": str(e)})


@app.get("/api/search/artists")
def search_artists_ep():
    try:
        from components.profile import search_artists
        return jsonify({"artists": search_artists(_arg("q"), _int_arg("limit", 10))})
    except Exception as e:
        return jsonify({"artists": [], "error": str(e)})


@app.get("/api/album")
def album_profile():
    name, artist = _arg("name"), _arg("artist")
    try:
        from components.profile import get_album
        return jsonify(get_album(name, artist, _arg("song_url"), _arg("album_id")))
    except Exception as e:
        return jsonify({"name": name, "artist": artist, "tracks": [], "error": str(e)})


@app.get("/api/search/albums")
def search_albums_ep():
    try:
        from components.profile import search_albums
        return jsonify({"albums": search_albums(_arg("q"), _int_arg("limit", 10))})
    except Exception as e:
        return jsonify({"albums": [], "error": str(e)})


@app.get("/api/home")
def home_feed():
    try:
        from components.home import get_home
        return jsonify(get_home(_arg("language", "hindi,english")))
    except Exception as e:
        return jsonify({"rows": [], "error": str(e)})


@app.get("/api/playlist")
def playlist_detail():
    try:
        from components.home import get_playlist
        return jsonify(get_playlist(_arg("url")))
    except Exception as e:
        return jsonify({"name": "", "tracks": [], "error": str(e)})


@app.get("/api/genres")
def genre_tiles():
    try:
        from components.home import get_genres
        return jsonify(get_genres(_arg("language", "hindi,english")))
    except Exception as e:
        return jsonify({"tiles": [], "error": str(e)})


@app.post("/api/enrich")
def enrich_batch():
    """Batch iTunes enrichment. Called AFTER search results render, so search
    stays instant while clean metadata fills in a moment later."""
    tracks = (_body().get("tracks") or [])
    if _enricher is None or not tracks:
        return jsonify({"results": [None] * len(tracks)})

    def lookup_one(item):
        try:
            meta = _enricher._lookup(
                item.get("title") or "",
                item.get("artist") or "",
                item.get("isrc"),
                item.get("duration_ms"),
            )
        except Exception:
            meta = None
        if not meta:
            return None
        return {
            "artist": _clean_text(meta.get("artist")) or None,
            "album": _clean_text(meta.get("album")) or None,
            "isrc": meta.get("isrc"),
            "release_date": meta.get("release_date"),
            "genre": meta.get("genre"),
            "duration_ms": meta.get("duration_ms"),
            "artwork": meta.get("artwork") or {},
        }

    try:
        # executor.map preserves input order, which the frontend relies on to
        # align results with the tracks it sent.
        with ThreadPoolExecutor(max_workers=6) as executor:
            results = list(executor.map(lookup_one, tracks))
        return jsonify({"results": results})
    except Exception as e:
        return jsonify({"results": [None] * len(tracks), "error": str(e)})


# ─── Spotify playlist import ──────────────────────────────────────────────────
# Spotify itself is NOT a playable source — we never stream from it. We only read
# a public playlist's TRACK LIST (title + artist), then find each song on
# JioSaavn/SoundCloud so it becomes playable here.
#
# No Spotify API key is needed: the public embed endpoint returns the tracklist
# as JSON. If Spotify changes that shape this degrades to "playlist not found"
# rather than breaking anything else.
_SPOTIFY_URL_RE = re.compile(
    r"open\.spotify\.com/(?:intl-[a-z]{2}/)?(playlist|album)/([A-Za-z0-9]+)"
)


def parse_spotify_url(url: str):
    """-> (kind, id) for a Spotify playlist/album URL or URI, else (None, None)."""
    if not url:
        return None, None
    m = _SPOTIFY_URL_RE.search(url)
    if m:
        return m.group(1), m.group(2)
    # spotify:playlist:37i9dQ...
    m = re.match(r"spotify:(playlist|album):([A-Za-z0-9]+)", url.strip())
    if m:
        return m.group(1), m.group(2)
    return None, None


def _spotify_tracklist(kind: str, sid: str):
    """Read {name, tracks:[{title, artist}]} from Spotify's public embed page."""
    r = http_requests.get(
        f"https://open.spotify.com/embed/{kind}/{sid}",
        headers={
            "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
            "Accept-Language": "en",
        },
        timeout=15,
    )
    if r.status_code != 200:
        return None

    # The embed page ships its state in a __NEXT_DATA__ script tag.
    m = re.search(
        r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', r.text, re.DOTALL
    )
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
    except Exception:
        return None

    entity = (
        data.get("props", {}).get("pageProps", {}).get("state", {})
        .get("data", {}).get("entity", {})
    )
    if not entity:
        return None

    name = entity.get("name") or entity.get("title") or "Spotify playlist"
    items = entity.get("trackList") or []

    def _norm_ws(s: str) -> str:
        # Spotify separates multiple artists with a NON-BREAKING space
        # ("Shakira,\xa0Burna Boy"). Left in, it poisons the search query.
        return " ".join((s or "").replace("\xa0", " ").split())

    tracks = []
    for it in items:
        title = _norm_ws(it.get("title"))
        artist = _norm_ws(it.get("subtitle"))
        if title:
            tracks.append({"title": title, "artist": artist})

    cover = ""
    try:
        cover = entity.get("coverArt", {}).get("sources", [{}])[0].get("url", "")
    except Exception:
        pass
    return {"name": _norm_ws(name), "tracks": tracks, "image": cover}


def _match_track(item: Dict[str, str]) -> Optional[Dict[str, Any]]:
    """Find a PLAYABLE version of one Spotify track on our own sources."""
    if _search_service is None:
        return None
    query = f"{item['title']} {item['artist']}".strip()
    try:
        cfg = replace(
            _search_service.config,
            max_total_results=1,
            max_results_per_source=3,
            enabled_sources=PLAYABLE_SEARCH_SOURCES,
            timeout_seconds=10.0,
        )
        for track in _search_service.search(query, cfg):
            source = _playable_source_name(track)
            if not source:
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


@app.get("/api/spotify/import")
def spotify_import():
    """Resolve a public Spotify playlist/album URL into playable tracks.

    Each Spotify track is matched to JioSaavn/SoundCloud by title+artist. Songs
    with no match are reported in `missing` rather than silently dropped, so the
    user knows what didn't come across.
    """
    url = _arg("url")
    kind, sid = parse_spotify_url(url)
    if not kind:
        return jsonify({"error": "Not a Spotify playlist or album link"}), 400

    try:
        meta = _spotify_tracklist(kind, sid)
    except Exception as e:
        return jsonify({"error": f"Could not read that playlist: {e}"}), 502
    if not meta:
        return jsonify({"error": "Could not read that playlist — is it public?"}), 502

    # Cap the work: matching runs a real search per track.
    items = meta["tracks"][:100]

    # Matching is network-bound, so fan out. Order is preserved by executor.map.
    with ThreadPoolExecutor(max_workers=6) as ex:
        matched = list(ex.map(_match_track, items))

    tracks = [t for t in matched if t]
    missing = [
        f"{i['title']} — {i['artist']}"
        for i, t in zip(items, matched) if not t
    ]

    return jsonify({
        "name": meta["name"],
        "image": meta.get("image", ""),
        "tracks": tracks,
        "missing": missing,
        "total": len(items),
        "matched": len(tracks),
    })


@app.get("/api/sources/status")
def sources_status():
    sources = {
        "jiosaavn": {"status": "ready", "type": "audio", "quality": "320kbps AAC"},
        "soundcloud": {"status": "ready", "type": "audio", "quality": "128kbps MP3"},
        "itunes": {"status": "ready", "type": "metadata", "quality": "artwork/tags"},
        "musicbrainz": {"status": "ready", "type": "metadata", "quality": "ISRC/lookup"},
        "youtube": {
            "status": "unavailable",
            "type": "audio",
            "quality": "n/a",
            "error": "YouTube needs a JavaScript runtime (Deno) to solve its "
                     "signature challenge; none exists for Android.",
        },
    }
    return jsonify({"sources": sources})


# ─── YouTube endpoints: permanent stubs ───────────────────────────────────────
# SettingsView still calls these. They must answer (never 404) or the settings
# screen shows a spinner forever — but they always report "not connected".
@app.get("/api/youtube/status")
def youtube_status():
    return jsonify({"connected": False, "method": None, "browser": None,
                    "browsers": [], "supported": False,
                    "reason": "YouTube is not supported on mobile."})


@app.post("/api/youtube/connect")
@app.post("/api/youtube/connect_file")
def youtube_connect():
    return jsonify({"connected": False,
                    "error": "YouTube is not supported on the mobile build."})


@app.post("/api/youtube/disconnect")
def youtube_disconnect():
    return jsonify({"connected": False})


# ─── SPA ──────────────────────────────────────────────────────────────────────
# Serving the React bundle from the SAME origin as the API is what lets
# frontend/src/utils/config.js keep its relative base: fetch('/api/...') and
# <audio src="/api/proxy_stream?..."> both resolve here with no CORS and with
# working Range requests.
@app.get("/")
def spa_index():
    return send_from_directory(android_env.web_dir(), "index.html")


@app.get("/<path:filename>")
def spa_assets(filename):
    root = android_env.web_dir()
    if os.path.isfile(os.path.join(root, filename)):
        return send_from_directory(root, filename)
    # Unknown non-API path → let the client-side router handle it.
    return send_from_directory(root, "index.html")


# ──────────────────────────────────────────────────────────────────────────────
# Lifecycle — called from Kotlin
# ──────────────────────────────────────────────────────────────────────────────
def _warm_up():
    """Pay the cold-start costs in the background so the user's FIRST search and
    FIRST lyrics lookup are already warm (lazy imports, SoundCloud client_id
    resolution, TLS handshakes). Best-effort; never blocks startup."""
    try:
        _lyrics_session.get("https://lrclib.net/api/search",
                            params={"q": "hello"}, timeout=10)
    except Exception:
        pass
    try:
        cfg = replace(
            _search_service.config, max_total_results=5,
            enabled_sources=PLAYABLE_SEARCH_SOURCES, timeout_seconds=15.0,
        )
        _search_service.search("hello", cfg)
    except Exception:
        pass


def start_server(files_dir: str, downloads_dir: str, web_dir: str,
                 cache_dir: str, port: int = 8765, public_dir: str = "",
                 api_token: str = "") -> int:
    """Entry point invoked from BackendService.kt.

    Blocks forever serving requests, so Kotlin must call it on a background
    thread. Returns only if the server is shut down.
    """
    global _search_service, _download_manager, _enricher, _server

    global _API_TOKEN
    _API_TOKEN = api_token or ""

    android_env.configure(files_dir, downloads_dir, web_dir, cache_dir, public_dir)
    android_env.install_stdio_logging()

    print(f"[backend] starting on 127.0.0.1:{port}")
    print(f"[backend] downloads -> {android_env.downloads_dir()}")
    print(f"[backend] web root  -> {android_env.web_dir()}")

    _search_service = UnifiedSearchService()
    # 2 concurrent downloads, not the desktop's 3: phones have less bandwidth
    # headroom and Android is quicker to throttle a chatty background process.
    _download_manager = DownloadManager(
        config=DownloadQueueConfig(max_concurrent=2),
        download_dir=get_default_download_dir(),
    )
    _download_manager.start()
    _enricher = MetadataEnricher()
    _download_manager.set_finalizer(_finalize_track_info)

    threading.Thread(target=_warm_up, daemon=True).start()

    # Werkzeug's production-grade WSGI server. Threaded so a long proxy_stream
    # (which holds its connection open for the whole song) can't block search,
    # lyrics, or the download queue.
    _server = make_server("127.0.0.1", port, app, threaded=True)
    print(f"[backend] ready on 127.0.0.1:{port}")
    _server.serve_forever()
    return port


def stop_server() -> None:
    global _server
    if _server is not None:
        _server.shutdown()
        _server = None
    if _download_manager:
        _download_manager.stop()
    if _search_service:
        _search_service.shutdown()


if __name__ == "__main__":
    # Desktop smoke test:
    #   cd mobile/python && python mobile_server.py [--port 8765]
    # Serves the mobile UI + API on localhost using throwaway local folders, so
    # you can iterate on the whole app in a browser without an emulator.
    import argparse

    parser = argparse.ArgumentParser(description="Fix_Spotify mobile backend")
    parser.add_argument("--port", type=int, default=8765)
    args, _ = parser.parse_known_args()

    base = Path(__file__).resolve().parent / ".devroot"
    web = Path(__file__).resolve().parents[2] / "frontend" / "dist-mobile"
    start_server(
        files_dir=str(base / "files"),
        downloads_dir=str(base / "downloads"),
        web_dir=str(web),
        cache_dir=str(base / "cache"),
        port=args.port,
    )
