package com.xmrnoobx.fixspotify

import android.content.Context
import android.util.Log
import com.whl.quickjs.android.QuickJSLoader
import com.whl.quickjs.wrapper.QuickJSContext

/**
 * A headless JavaScript runtime, backed by an embedded quickjs-ng engine.
 *
 * YouTube gates its stream URLs behind an obfuscated JS "signature" challenge.
 * Since late 2025 yt-dlp cannot solve it in pure Python — it requires a real JS
 * engine (Deno/Node/QuickJS). The desktop build bundles Deno; Android has no
 * Deno build. QuickJS is one of yt-dlp's officially supported runtimes, so the
 * solver is authored and tested against it.
 *
 * Engine history matters here:
 *  - A hidden WebView was attempt #1 — not a supported yt-dlp target, failed.
 *  - app.cash.quickjs was attempt #2 — it wraps a 2019 QuickJS that cannot even
 *    PARSE the modern (ES2020+) solver, hence "couldn't solve a YouTube
 *    challenge on this device".
 *  - This wrapper ships quickjs-ng (current), which handles modern JS.
 *
 * evaluate() runs synchronously on the calling thread (Chaquopy's request
 * thread); the wrapper guards the runtime with Java synchronization, so no
 * main-thread or Looper dance is needed. A fresh context per call mirrors how
 * yt-dlp's own quickjs provider runs a fresh `qjs` process per solve — no state
 * leaks between challenges.
 */
object JsEngine {

    private const val TAG = "FixSpotifyJs"

    @Volatile private var loaded = false

    private fun ensureLoaded(): Boolean {
        if (loaded) return true
        synchronized(this) {
            if (loaded) return true
            return try {
                QuickJSLoader.init()   // loads the native quickjs-ng library once
                loaded = true
                true
            } catch (e: Throwable) {
                Log.e(TAG, "QuickJS native library failed to load", e)
                false
            }
        }
    }

    /** True when the QuickJS native library loads and a context can be created. */
    @JvmStatic
    fun isSupported(context: Context): Boolean = try {
        if (!ensureLoaded()) {
            false
        } else {
            QuickJSContext.create().destroy()
            true
        }
    } catch (e: Throwable) {
        Log.w(TAG, "QuickJS unavailable on this device", e)
        false
    }

    /**
     * Evaluate [script] and return the string value of its final expression.
     *
     * webview_jcp wraps the solver so its last expression is the captured
     * console output — that value IS the stdout yt-dlp wants. Returns a string
     * starting with "__JSERR__" on any failure; the Python side treats that as
     * "runtime unavailable" and YouTube simply stays off, never a crash. The
     * unused [context] parameter keeps the Python call site engine-agnostic.
     */
    @JvmStatic
    fun evaluate(context: Context, script: String): String {
        if (!ensureLoaded()) return "__JSERR__ native library unavailable"
        var qjs: QuickJSContext? = null
        return try {
            qjs = QuickJSContext.create()
            // The solver recurses deeply while deobfuscating; the default stack
            // is tight. Best-effort — older wrapper versions may lack the API.
            try { qjs.setMaxStackSize(1024 * 1024) } catch (_: Throwable) { }
            val result = qjs.evaluate(script)
            result?.toString() ?: "__JSERR__ script returned null"
        } catch (e: Throwable) {
            Log.e(TAG, "JS evaluate failed", e)
            "__JSERR__ ${e.message ?: e.javaClass.simpleName}"
        } finally {
            try { qjs?.destroy() } catch (_: Throwable) { }
        }
    }
}
