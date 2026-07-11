"""
Android environment bootstrap.
==============================
Chaquopy runs CPython inside the app process, so there is no "user home",
no Music folder, and no writable CWD in the usual sense. Kotlin hands us the
concrete app directories at startup (see BackendService.kt) and this module
turns them into the paths the rest of the backend expects.

Import this BEFORE anything from components/ — it sets HOME, which several
components read via Path.home().
"""

import os
import sys
from pathlib import Path

# Populated by configure() before the server starts.
_dirs = {
    "files": "",       # app-private internal storage (config, cookies, caches)
    "downloads": "",   # app-private EXTERNAL storage — where audio lands
    "web": "",         # extracted React bundle served as the SPA
    "cache": "",
}


def configure(files_dir: str, downloads_dir: str, web_dir: str, cache_dir: str) -> None:
    """Called once from Kotlin with the real Android paths."""
    _dirs["files"] = files_dir
    _dirs["downloads"] = downloads_dir
    _dirs["web"] = web_dir
    _dirs["cache"] = cache_dir

    for key in ("files", "downloads", "cache"):
        try:
            Path(_dirs[key]).mkdir(parents=True, exist_ok=True)
        except Exception:
            pass

    # components/ and api/main.py both use Path.home() for config + downloads.
    # Point it at app-private internal storage so those calls resolve to a real,
    # writable location instead of "/" (which is read-only on Android).
    os.environ["HOME"] = files_dir
    os.environ.setdefault("XDG_CACHE_HOME", cache_dir)

    # yt-dlp writes temp/part files next to the output, but its cache dir would
    # otherwise land somewhere unwritable.
    os.environ.setdefault("XDG_CONFIG_HOME", files_dir)

    # requests/certifi: Chaquopy ships certifi, but some transitive code reads
    # these env vars directly.
    try:
        import certifi
        os.environ.setdefault("SSL_CERT_FILE", certifi.where())
        os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
    except Exception:
        pass

    # Android has no HTTP_PROXY notion by default; make sure a stale value from
    # the host environment can't break every outbound call.
    for var in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        os.environ.pop(var, None)


def files_dir() -> str:
    return _dirs["files"]


def downloads_dir() -> str:
    """Where downloaded audio is written.

    This is the app-specific external directory
    (/storage/emulated/0/Android/data/<pkg>/files/Music). It needs NO runtime
    permission on any Android version, is visible over USB/file managers, and
    is removed on uninstall.
    """
    d = _dirs["downloads"] or str(Path(_dirs["files"]) / "Music")
    try:
        Path(d).mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return d


def web_dir() -> str:
    return _dirs["web"]


def cache_dir() -> str:
    return _dirs["cache"]


def is_android() -> bool:
    return bool(_dirs["files"])


def install_stdio_logging() -> None:
    """Chaquopy discards stdout/stderr unless redirected. Send both to logcat so
    `adb logcat -s FixSpotifyPy` shows Python tracebacks and Flask logs."""
    try:
        from java import jclass
        Log = jclass("android.util.Log")
    except Exception:
        return  # not running under Chaquopy (desktop test run) — leave stdio alone

    class _LogStream:
        def __init__(self, level):
            self._level = level
            self._buf = ""

        def write(self, text):
            self._buf += text
            while "\n" in self._buf:
                line, self._buf = self._buf.split("\n", 1)
                if line:
                    self._level("FixSpotifyPy", line)
            return len(text)

        def flush(self):
            if self._buf:
                self._level("FixSpotifyPy", self._buf)
                self._buf = ""

    sys.stdout = _LogStream(Log.i)
    sys.stderr = _LogStream(Log.e)
