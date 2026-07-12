package com.xmrnoobx.fixspotify

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import org.json.JSONArray
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * A headless JavaScript runtime, backed by the WebView the app already ships.
 *
 * YouTube gates its stream URLs behind an obfuscated JS "signature" challenge.
 * yt-dlp solves it by running a solver script in a real JS engine — Deno on the
 * desktop build. Android has no Deno, which is the only reason YouTube didn't
 * work on the phone. But Android has a WebView (a full browser engine) on every
 * device, and WebView.evaluateJavascript runs arbitrary JS. So we point a
 * hidden, never-attached WebView at about:blank and evaluate the solver in it.
 *
 * This deliberately does NOT use androidx.javascriptengine: that needs a recent
 * WebView feature many devices lack (the user hit exactly that — "not supported
 * on this device's system WebView"). A plain WebView works everywhere.
 *
 * evaluate() is called from Chaquopy's background request thread but WebView is
 * main-thread-only, so it hops to the main thread and blocks the caller on a
 * latch until the result comes back.
 */
object JsEngine {

    private const val TAG = "FixSpotifyJs"

    private val main = Handler(Looper.getMainLooper())
    @Volatile private var webView: WebView? = null

    /** Plain WebView is available on every Android device with a WebView. */
    @JvmStatic
    fun isSupported(context: Context): Boolean = try {
        WebView.getCurrentWebViewPackage() != null
    } catch (e: Throwable) {
        // Older APIs lack getCurrentWebViewPackage but still have WebView.
        true
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun ensureWebView(context: Context) {
        if (webView != null) return
        val latch = CountDownLatch(1)
        main.post {
            try {
                val wv = WebView(context.applicationContext)
                wv.settings.javaScriptEnabled = true
                wv.settings.domStorageEnabled = true
                wv.loadUrl("about:blank")
                webView = wv
            } catch (e: Throwable) {
                Log.e(TAG, "failed to create JS WebView", e)
            } finally {
                latch.countDown()
            }
        }
        latch.await(10, TimeUnit.SECONDS)
    }

    /**
     * Evaluate [script] and return the string value of its final expression.
     *
     * webview_jcp wraps the solver so its last expression is the captured
     * console output, so that value IS the stdout yt-dlp wants. Returns a string
     * starting with "__JSERR__" on any failure — the Python side treats that as
     * "runtime unavailable" and YouTube just stays off, never a crash.
     */
    @JvmStatic
    fun evaluate(context: Context, script: String): String {
        return try {
            ensureWebView(context)
            val wv = webView ?: return "__JSERR__ webview unavailable"

            val result = arrayOfNulls<String>(1)
            val latch = CountDownLatch(1)
            main.post {
                try {
                    // evaluateJavascript hands back the last expression JSON-
                    // encoded (a quoted string). Unwrap it below.
                    wv.evaluateJavascript(script) { value ->
                        result[0] = value
                        latch.countDown()
                    }
                } catch (e: Throwable) {
                    result[0] = "__JSERR__ ${e.message}"
                    latch.countDown()
                }
            }
            if (!latch.await(60, TimeUnit.SECONDS)) return "__JSERR__ timeout"

            val raw = result[0] ?: return "__JSERR__ null"
            // A thrown JS error or non-string comes back as "null".
            if (raw == "null") "__JSERR__ script returned null" else unwrapJson(raw)
        } catch (e: Throwable) {
            Log.e(TAG, "JS evaluate failed", e)
            "__JSERR__ ${e.message ?: e.javaClass.simpleName}"
        }
    }

    // evaluateJavascript returns a JSON literal. For our string results that's a
    // quoted, escaped string; decode it with JSONArray so \n, \" etc. survive.
    private fun unwrapJson(raw: String): String = try {
        JSONArray("[$raw]").getString(0)
    } catch (e: Throwable) {
        raw
    }

    @JvmStatic
    fun shutdown() {
        main.post {
            try { webView?.destroy() } catch (e: Throwable) { /* ignore */ }
            webView = null
        }
    }
}
