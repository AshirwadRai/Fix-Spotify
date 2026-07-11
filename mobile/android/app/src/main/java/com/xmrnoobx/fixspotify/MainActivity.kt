package com.xmrnoobx.fixspotify

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.AudioDeviceInfo
import android.media.AudioManager
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
import kotlin.concurrent.thread

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
    // The release found by checkForUpdate(), consumed by installUpdate().
    private var pendingUpdate: Updater.Release? = null
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

            /**
             * Name of the device audio is currently going OUT to — e.g. a pair of
             * Bluetooth earbuds. Returns "" for the phone's own speaker/earpiece,
             * which the UI treats as "nothing to show".
             *
             * The WebView cannot see this: routing is an OS concern, so it has to
             * come from AudioManager on the native side.
             */
            @JavascriptInterface
            fun getAudioOutput(): String = currentAudioOutput()

            /** Installed app version, so the UI can show "you're on x.y.z". */
            @JavascriptInterface
            fun getVersion(): String =
                packageManager.getPackageInfo(packageName, 0).versionName ?: ""

            /**
             * Check GitHub for a newer release. Returns a JSON string:
             *   {"available":true,"version":"1.2.0","notes":"…"}  or  {"available":false}
             * Network I/O, so it runs on a worker thread and the result is pushed
             * back into the page via window.__androidUpdate.
             */
            @JavascriptInterface
            fun checkForUpdate() {
                thread(isDaemon = true) {
                    val rel = Updater.check(this@MainActivity)
                    pendingUpdate = rel
                    val json = if (rel == null) {
                        JSONObject().put("available", false)
                    } else {
                        JSONObject()
                            .put("available", true)
                            .put("version", rel.version)
                            .put("notes", rel.notes)
                    }
                    runOnUiThread {
                        webView.evaluateJavascript(
                            "window.__androidUpdate && window.__androidUpdate($json)", null
                        )
                    }
                }
            }

            /**
             * Download the pending update and open the installer. Installing OVER
             * the existing app keeps all user data (same signing key) — nothing is
             * lost, unlike an uninstall/reinstall.
             */
            @JavascriptInterface
            fun installUpdate() {
                val rel = pendingUpdate ?: return
                thread(isDaemon = true) {
                    Updater.downloadAndInstall(this@MainActivity, rel) { pct ->
                        runOnUiThread {
                            webView.evaluateJavascript(
                                "window.__androidUpdateProgress && window.__androidUpdateProgress($pct)",
                                null
                            )
                        }
                    }
                }
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

    /**
     * The current audio output device's product name (Bluetooth headset, USB
     * headphones, …), or "" when audio is going to the phone itself.
     *
     * Uses getDevices(GET_DEVICES_OUTPUTS) rather than the deprecated
     * isBluetoothA2dpOn(), so USB/wired devices are named too. No permission is
     * needed for the product name — unlike BluetoothAdapter, which would require
     * BLUETOOTH_CONNECT on Android 12+.
     */
    private fun currentAudioOutput(): String = try {
        val am = getSystemService(AUDIO_SERVICE) as AudioManager
        val routed = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull { d ->
            d.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                d.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                d.type == AudioDeviceInfo.TYPE_USB_HEADSET ||
                d.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                d.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                    d.type == AudioDeviceInfo.TYPE_BLE_HEADSET)
        }
        routed?.productName?.toString()?.trim().orEmpty()
    } catch (e: Exception) {
        ""
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
