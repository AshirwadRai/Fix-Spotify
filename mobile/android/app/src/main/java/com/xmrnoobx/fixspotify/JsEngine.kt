package com.xmrnoobx.fixspotify

import android.content.Context
import android.util.Log
import app.cash.quickjs.QuickJs

/**
 * A headless JavaScript runtime, backed by an embedded QuickJS engine.
 *
 * YouTube gates its stream URLs behind an obfuscated JS "signature" challenge.
 * Since late 2025 yt-dlp can no longer solve it in pure Python — it requires a
 * real external JS engine (Deno/Node/QuickJS). The desktop build bundles Deno;
 * Android has no Deno build. QuickJS, however, ships a tiny C engine with a
 * prebuilt Android library, AND it is one of yt-dlp's officially supported
 * runtimes — the challenge solver is authored and tested against it. That makes
 * it the correct, safe engine here, unlike the earlier WebView attempt (a plain
 * WebView isolate is not a supported target and was missing globals / hitting
 * evaluateJavascript size limits, which is why it "couldn't solve the challenge").
 *
 * evaluate() runs synchronously on the calling thread (Chaquopy's request
 * thread) — QuickJS has no main-thread requirement, so there is no Handler/latch
 * dance. A fresh context per call mirrors how yt-dlp's own quickjs provider runs
 * a fresh `qjs` process per solve: no state leaks between challenges.
 */
object JsEngine {

    private const val TAG = "FixSpotifyJs"

    /** True when the QuickJS native library loaded and a context can be created. */
    @JvmStatic
    fun isSupported(context: Context): Boolean = try {
        QuickJs.create().close()
        true
    } catch (e: Throwable) {
        Log.w(TAG, "QuickJS unavailable on this device", e)
        false
    }

    /**
     * Evaluate [script] and return the string value of its final expression.
     *
     * webview_jcp wraps the solver so its last expression is the captured
     * console output, so that value IS the stdout yt-dlp wants. Returns a string
     * starting with "__JSERR__" on any failure — the Python side treats that as
     * "runtime unavailable" and YouTube just stays off, never a crash. The
     * unused [context] is kept so the Python call site is engine-agnostic.
     */
    @JvmStatic
    fun evaluate(context: Context, script: String): String {
        return try {
            val qjs = QuickJs.create()
            try {
                val result = qjs.evaluate(script)
                result?.toString() ?: "__JSERR__ script returned null"
            } finally {
                qjs.close()
            }
        } catch (e: Throwable) {
            Log.e(TAG, "JS evaluate failed", e)
            "__JSERR__ ${e.message ?: e.javaClass.simpleName}"
        }
    }
}
