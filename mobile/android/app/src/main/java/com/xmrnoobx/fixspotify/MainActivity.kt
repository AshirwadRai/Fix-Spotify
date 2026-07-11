package com.xmrnoobx.fixspotify

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * The whole UI: a WebView pointed at the on-device Flask server.
 *
 * Because the server hosts BOTH the React bundle and the `/api` routes, the page
 * runs on the same origin as the API. (Do not write that path with a glob here:
 * Kotlin NESTS block comments, so a slash-star inside a KDoc opens a comment
 * that never closes.) That means no CORS, relative fetch() paths, and —
 * critically — an <audio> element that can issue Range requests against
 * /api/proxy_stream and seek properly.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var splash: View
    private val handler = Handler(Looper.getMainLooper())

    private var pageLoaded = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        splash = findViewById(R.id.splash)

        requestNotificationPermission()

        // Start the backend BEFORE the WebView needs it.
        ContextCompat.startForegroundService(
            this, Intent(this, BackendService::class.java)
        )

        configureWebView()
        registerTransportBridge()
        registerBackHandler()

        waitForBackendThenLoad()
    }

    // ── WebView ───────────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.setBackgroundColor(Color.BLACK)   // avoid a white flash before paint

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true              // the app keeps its library in localStorage

            // Without this the <audio> element refuses to start without a tap on
            // EVERY track, which breaks autoplay-next and radio entirely.
            mediaPlaybackRequiresUserGesture = false

            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = false
            loadWithOverviewMode = false
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100                        // ignore the system font-size setting
        }

        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                if (pageLoaded) return
                pageLoaded = true
                // Fade the splash out only once React has actually painted.
                splash.animate().alpha(0f).setDuration(250).withEndAction {
                    splash.visibility = View.GONE
                }.start()
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT && BuildConfig.DEBUG) {
            // chrome://inspect works against the running app in debug builds.
            WebView.setWebContentsDebuggingEnabled(true)
        }
    }

    /** Poll /health, then load the SPA. A cold Python boot takes a few seconds. */
    private fun waitForBackendThenLoad() {
        if (BackendService.serverReady.get()) {
            webView.loadUrl(BackendService.BASE_URL)
            return
        }
        handler.postDelayed({ waitForBackendThenLoad() }, 250)
    }

    // ── JS ⇄ native bridge ────────────────────────────────────────────────────

    /**
     * The React player already drives navigator.mediaSession. That surfaces the
     * page's metadata to Chromium, but a bare WebView does not forward it to the
     * Android media session — so lock-screen controls would do nothing.
     *
     * This bridge closes the loop: JS reports its state here, and transport
     * buttons from the notification/lock screen are pushed back into the page.
     */
    private fun registerTransportBridge() {
        webView.addJavascriptInterface(object {
            @JavascriptInterface
            fun updatePlayback(json: String) {
                val o = try { JSONObject(json) } catch (e: Exception) { return }
                BackendService.instance?.updatePlayback(
                    title = o.optString("title"),
                    artist = o.optString("artist"),
                    playing = o.optBoolean("playing"),
                    durationMs = o.optLong("duration"),
                    positionMs = o.optLong("position"),
                    artworkUrl = o.optString("artwork").takeIf { it.isNotBlank() }
                )
            }
        }, "AndroidPlayer")

        BackendService.instance?.transportListener = object : BackendService.TransportListener {
            override fun onCommand(action: String) {
                // window.__androidTransport is installed by the mobile React app
                // (see frontend/src/mobile/androidBridge.js).
                runOnUiThread {
                    webView.evaluateJavascript(
                        "window.__androidTransport && window.__androidTransport('$action')",
                        null
                    )
                }
            }
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Deliberately does NOT call webView.onPause().
     *
     * WebView.onPause() suspends all media in the page — so the standard
     * "pause the WebView when the activity stops" idiom is exactly what would
     * kill background playback. The foreground service keeps the process alive;
     * we just have to not stop the page ourselves.
     */
    override fun onPause() {
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        // The service may have been (re)created after the activity; re-attach.
        registerTransportBridge()
    }

    private fun registerBackHandler() {
        // The React app pushes a history entry per navigation, so Back should
        // walk that stack. Only when there is nothing left do we leave the app —
        // and even then we move it to the background rather than destroying it,
        // so music keeps playing.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    moveTaskToBack(true)
                }
            }
        })
    }

    private fun requestNotificationPermission() {
        // Android 13+: the foreground-service notification (and therefore the
        // media controls) is silently dropped without this.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED
        ) return
        ActivityCompat.requestPermissions(
            this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001
        )
    }
}
