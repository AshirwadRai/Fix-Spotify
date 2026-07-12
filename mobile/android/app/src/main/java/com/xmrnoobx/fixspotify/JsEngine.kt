package com.xmrnoobx.fixspotify

import android.content.Context
import android.util.Log
import androidx.javascriptengine.JavaScriptSandbox
import androidx.javascriptengine.JavaScriptIsolate
import androidx.javascriptengine.IsolateStartupParameters
import java.util.concurrent.TimeUnit

/**
 * A headless JavaScript runtime, backed by the system WebView's V8 through
 * androidx.javascriptengine.
 *
 * Why this exists: YouTube hides its stream URLs behind an obfuscated JavaScript
 * "signature" challenge. yt-dlp solves it by running a solver script in a real
 * JS engine — Deno on the desktop build. Android has no Deno, which is the ONLY
 * reason YouTube didn't work on the phone. The system WebView, however, ships a
 * full V8, and this class exposes it as a plain "run this script, give me what
 * it printed" service that a yt-dlp provider (see webview_jcp.py) drives over the
 * Chaquopy bridge.
 *
 * Everything here is best-effort and fully isolated from app startup:
 *   • the sandbox is created lazily, on the first YouTube attempt, never at boot
 *   • isSupported() is checked before use — many older WebViews lack the feature
 *   • every failure returns an error string, never throws into Python
 * So if this doesn't work on a given device, YouTube simply stays unavailable —
 * exactly the state the app was already in — and nothing else is affected.
 */
object JsEngine {

    private const val TAG = "FixSpotifyJs"

    // A single sandbox process is reused across calls; V8 startup is the
    // expensive part and the solver is invoked repeatedly during a session.
    @Volatile private var sandbox: JavaScriptSandbox? = null
    private val lock = Any()

    /** True when this device's WebView can host a JS sandbox at all. */
    fun isSupported(context: Context): Boolean = try {
        JavaScriptSandbox.isSupported()
    } catch (e: Throwable) {
        Log.w(TAG, "javascriptengine not supported", e)
        false
    }

    private fun ensureSandbox(context: Context): JavaScriptSandbox? {
        sandbox?.let { return it }
        synchronized(lock) {
            sandbox?.let { return it }
            return try {
                if (!JavaScriptSandbox.isSupported()) return null
                // Block once, here, to create the process. Callers are already on
                // a background thread (Chaquopy's request thread).
                val sb = JavaScriptSandbox
                    .createConnectedInstanceAsync(context.applicationContext)
                    .get(30, TimeUnit.SECONDS)
                sandbox = sb
                sb
            } catch (e: Throwable) {
                Log.e(TAG, "failed to start JS sandbox", e)
                null
            }
        }
    }

    /**
     * Evaluate [script] and return the string value of its final expression.
     *
     * The caller (webview_jcp.py) wraps the yt-dlp solver so its last expression
     * is the captured console output, so that value IS the stdout yt-dlp wants.
     *
     * Returns a string beginning with "__JSERR__" on any failure, which the
     * Python side treats as "runtime unavailable" and moves on — YouTube just
     * won't play, nothing crashes.
     */
    @JvmStatic
    fun evaluate(context: Context, script: String): String {
        val sb = ensureSandbox(context)
            ?: return "__JSERR__ sandbox unavailable"
        return try {
            // A fresh isolate per evaluation: the solver mutates globals, and a
            // clean slate avoids state leaking between challenges. Give it enough
            // heap for the (fairly large) solver bundle.
            val params = IsolateStartupParameters().apply {
                setMaxHeapSizeBytes(128L * 1024 * 1024)
            }
            sb.createIsolate(params).use { isolate ->
                isolate.evaluateJavaScriptAsync(script).get(30, TimeUnit.SECONDS) ?: ""
            }
        } catch (e: Throwable) {
            Log.e(TAG, "JS evaluate failed", e)
            "__JSERR__ ${e.message ?: e.javaClass.simpleName}"
        }
    }

    /** Release the sandbox process. Safe to call even if never started. */
    @JvmStatic
    fun shutdown() {
        synchronized(lock) {
            try {
                sandbox?.close()
            } catch (e: Throwable) {
                Log.w(TAG, "sandbox close failed", e)
            }
            sandbox = null
        }
    }
}
