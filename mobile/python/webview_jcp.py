"""
YouTube JS-challenge provider backed by the Android WebView's V8.
=================================================================
YouTube gates its stream URLs behind an obfuscated JavaScript "signature"
challenge. yt-dlp solves it by running a solver script in a real JS engine — Deno
on the desktop build. Android has no Deno, which is the ONLY reason YouTube never
worked on the phone.

The system WebView, though, ships a full V8. JsEngine.kt exposes it as a plain
"run this script, return what it printed" service. This module plugs that service
into yt-dlp as a challenge provider, reusing yt-dlp's own EJS solver bundle
(pip package yt-dlp-ejs) — so we do not reimplement the cryptography, only swap
where the JavaScript executes.

EXPERIMENTAL / OFF BY DEFAULT. It is enabled only when the user turns it on in
Settings AND a self-test solves a real challenge on their device. Everything is
guarded: any failure leaves YouTube simply unavailable — the state the app was
already in — and never affects JioSaavn/SoundCloud or app startup.

Enable path:
    import webview_jcp
    webview_jcp.install()          # registers the provider, idempotent
    ok = webview_jcp.self_test()   # True if a real challenge solved on-device
"""

import json
import logging

log = logging.getLogger("webview_jcp")

_installed = False
_JS_ERROR_SENTINEL = "__JSERR__"

# Optional cookies.txt path (set by mobile_server). Used as the auth fallback
# when YouTube demands a signed-in session ("confirm you're not a bot").
COOKIES_FILE = ""


def _run_via_webview(script: str) -> str:
    """Execute a solver program in the WebView's V8 and return its stdout.

    yt-dlp's solver ends in `console.log(JSON.stringify(...))`. A bare V8 isolate
    has no `console`, and evaluateJavaScriptAsync returns the value of the LAST
    expression — so we install a console shim that captures output and make the
    final expression the captured text. That captured text IS the stdout yt-dlp
    expects.
    """
    from java import jclass  # Chaquopy — only importable inside the APK
    from com.chaquo.python import Python

    ctx = Python.getInstance().getPlatform().getApplication()
    JsEngine = jclass("com.xmrnoobx.fixspotify.JsEngine")

    wrapped = (
        "var __out=[];"
        "var console={log:function(){"
        "__out.push(Array.prototype.slice.call(arguments).join(' '))"
        "},error:function(){},warn:function(){},info:function(){}};\n"
        + script
        + "\n;__out.join('\\n')"
    )
    result = JsEngine.evaluate(ctx, wrapped)
    if result is None:
        raise RuntimeError("JS engine returned null")
    result = str(result)
    if result.startswith(_JS_ERROR_SENTINEL):
        raise RuntimeError(result[len(_JS_ERROR_SENTINEL):].strip() or "JS engine error")
    return result


def is_supported() -> bool:
    """True only when this device's WebView can host a JS sandbox at all."""
    try:
        from java import jclass
        from com.chaquo.python import Python
        ctx = Python.getInstance().getPlatform().getApplication()
        return bool(jclass("com.xmrnoobx.fixspotify.JsEngine").isSupported(ctx))
    except Exception as e:
        log.warning("JsEngine.isSupported failed: %s", e)
        return False


def install() -> bool:
    """Register the WebView provider with yt-dlp. Idempotent; safe to call from a
    guarded caller. Returns False (never raises) if anything is missing."""
    global _installed
    if _installed:
        return True
    try:
        from yt_dlp.extractor.youtube.jsc._builtin.ejs import EJSBaseJCP
        from yt_dlp.extractor.youtube.jsc.provider import register_provider
        from yt_dlp.utils._jsruntime import JsRuntimeInfo

        # A fixed runtime descriptor. The base class normally reads this from
        # yt-dlp's binary detection (which only knows deno/node/bun/quickjs); we
        # supply it directly so no binary is looked for.
        _WEBVIEW_INFO = JsRuntimeInfo(
            name="webview",
            path="webview",
            version="1.0.0",
            version_tuple=(1, 0, 0),
            supported=True,
        )

        @register_provider
        class WebViewJCP(EJSBaseJCP):
            PROVIDER_NAME = "webview"
            JS_RUNTIME_NAME = "webview"

            @property
            def runtime_info(self):
                # Bypass binary detection entirely.
                return _WEBVIEW_INFO

            def is_available(self, /) -> bool:
                # Available when the device's V8 sandbox is usable. `_available`
                # is set by the base class once the solver scripts are found.
                try:
                    return bool(self._available) and is_supported()
                except Exception:
                    return False

            def _run_js_runtime(self, stdin, /):
                return _run_via_webview(stdin)

        _installed = True
        log.info("WebView YouTube provider registered")
        return True
    except Exception as e:
        log.warning("could not register WebView provider: %s", e)
        return False


# The tiniest possible standalone check: does the engine run JS and return a
# value at all? A quick smoke test before attempting real extraction.
_SMOKE = "var a=1+2; var s=JSON.stringify({ok:a===3}); s"


def engine_smoke_test() -> bool:
    """Cheap check that the JS engine evaluates and returns a value."""
    try:
        out = _run_via_webview("console.log(" + json.dumps("SMOKE_OK") + ")")
        return "SMOKE_OK" in out
    except Exception as e:
        log.warning("engine smoke test failed: %s", e)
        return False


def self_test(video_id: str = "BaW_jenozKc") -> bool:
    """End-to-end: can we actually extract a playable YouTube audio URL on THIS
    device? Uses a stable yt-dlp test video. Returns False on any failure — the
    caller uses this to decide whether to expose YouTube at all.
    """
    if not is_supported():
        return False
    if not install():
        return False
    if not engine_smoke_test():
        return False
    try:
        import yt_dlp
        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "format": "bestaudio/best",
            "js_runtimes": {"webview": {}},
        }
        import os
        if COOKIES_FILE and os.path.exists(COOKIES_FILE):
            opts["cookiefile"] = COOKIES_FILE
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(
                f"https://www.youtube.com/watch?v={video_id}", download=False
            )
        url = info.get("url") or next(
            (f.get("url") for f in reversed(info.get("formats") or []) if f.get("url")),
            None,
        )
        return bool(url)
    except Exception as e:
        log.warning("YouTube self-test failed: %s", e)
        return False
