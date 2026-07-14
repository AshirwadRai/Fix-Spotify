package com.xmrnoobx.fixspotify

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
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

    // Bridges <input type="file"> in the WebView to the system picker.
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooser = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        // The WebView blocks until this fires. Handing back null on cancel is
        // what tells it the user backed out, rather than leaving the input stuck.
        filePathCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        filePathCallback = null
    }

    // The system "pick a folder" screen (Storage Access Framework). It returns a
    // content:// tree URI, which we translate back to a real filesystem path so
    // yt-dlp and the tagger — which need a real path — can write there.
    private val folderPicker = registerForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri: Uri? ->
        val path = uri?.let { treeUriToPath(it) } ?: ""
        // Result goes back to the Settings screen through the page callback.
        runOnUiThread {
            webView.evaluateJavascript(
                "window.__androidFolderPicked && window.__androidFolderPicked(${jsString(path)})",
                null
            )
        }
    }

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

        // A bare WebChromeClient makes <input type="file"> a no-op: the WebView
        // has no way to open a picker on its own, so the tap silently does
        // nothing. Forwarding it to the system picker is what lets the user
        // choose a custom playlist cover.
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?,
            ): Boolean {
                // Only one picker at a time; cancel any previous callback so the
                // page's promise never hangs unresolved.
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                return try {
                    fileChooser.launch(params?.acceptTypes?.firstOrNull()?.takeIf { it.isNotBlank() } ?: "*/*")
                    true
                } catch (e: Exception) {
                    filePathCallback = null
                    callback?.onReceiveValue(null)
                    false
                }
            }
        }
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
             * The secret that authorises calls to the API routes. Handing it over
             * the bridge — rather than embedding it in the page — is the entire
             * point: any app on the device can fetch our HTML from 127.0.0.1, but
             * only the WebView we created has this bridge.
             */
            @JavascriptInterface
            fun getApiToken(): String = BackendService.API_TOKEN

            /**
             * Can we write a real file path into the phone's public Download
             * folder? Below Android 11 the old storage permission covers it;
             * from Android 11 on, only All-files access does.
             */
            @JavascriptInterface
            fun hasStorageAccess(): Boolean = hasAllFilesAccess()

            /**
             * Send the user to the system screen where All-files access is
             * granted. It CANNOT be granted from an in-app dialog — Android
             * requires the toggle to be flipped in Settings — so the UI has to
             * explain that before calling this.
             */
            @JavascriptInterface
            fun requestStorageAccess() {
                handler.post { openAllFilesAccessSettings() }
            }

            /**
             * Open the system folder picker. The chosen path is delivered back to
             * the page via window.__androidFolderPicked(path); an empty string
             * means the user cancelled or the folder can't map to a real path.
             */
            @JavascriptInterface
            fun pickDownloadFolder() {
                handler.post {
                    try {
                        folderPicker.launch(null)
                    } catch (e: Exception) {
                        Log.e(TAG, "folder picker failed", e)
                    }
                }
            }

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

        // Registered on the COMPANION, not on `instance`. The service is started
        // asynchronously, so `instance` is usually still null here — the old
        // `instance?.transportListener = …` therefore dropped the listener on the
        // floor most of the time, which is why the lock-screen buttons (and the
        // pause-on-unplug that rides the same path) only worked sometimes.
        BackendService.transportListener = object : BackendService.TransportListener {
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
        val outs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)

        // Rank matters. SCO is the PHONE's own call endpoint and reports the
        // handset's model as its productName ("2201116YU"), which is why the
        // wrong name showed up. Real headsets (A2DP / BLE / wired) come first.
        fun rank(t: Int) = when (t) {
            AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> 0
            AudioDeviceInfo.TYPE_USB_HEADSET -> 2
            AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> 3
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> 4
            else -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                t == AudioDeviceInfo.TYPE_BLE_HEADSET) 1 else 99
        }

        val routed = outs.filter { rank(it.type) < 99 }.minByOrNull { rank(it.type) }
        val name = routed?.productName?.toString()?.trim().orEmpty()

        // Some OEMs report the handset's own model as the productName. That is
        // never the headphone's name, so drop it rather than show a lie.
        if (name.isEmpty() || name.equals(Build.MODEL, true) || name.equals(Build.PRODUCT, true)) {
            if (routed == null) "" else "Bluetooth"
        } else {
            name
        }
    } catch (e: Exception) {
        ""
    }

    // ── Storage ───────────────────────────────────────────────────────────────

    /**
     * True when we can write a real file path into the public Download folder.
     *
     * From Android 11 (R) that means All-files access, which is a genuinely
     * broad permission — so it is never requested at launch, only when the user
     * deliberately chooses a public download folder. Below R, the classic
     * WRITE_EXTERNAL_STORAGE grant is both sufficient and narrower.
     */
    private fun hasAllFilesAccess(): Boolean = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            ContextCompat.checkSelfPermission(
                this, Manifest.permission.WRITE_EXTERNAL_STORAGE
            ) == PackageManager.PERMISSION_GRANTED
        }
    } catch (e: Exception) {
        false
    }

    /**
     * Translate a Storage-Access-Framework tree URI into a real filesystem path.
     *
     * The picker returns e.g. content://…/tree/primary:Music/Sub, whose document
     * id is "primary:Music/Sub". "primary" is the device's shared storage
     * (/storage/emulated/0); other volumes are /storage/<id>. yt-dlp and the
     * tagger need a real path, which is why we translate rather than keep the
     * URI. Returns "" for anything we can't confidently map (rare OEM cases),
     * so the caller can fall back instead of writing to a bad path.
     */
    private fun treeUriToPath(uri: Uri): String = try {
        val docId = android.provider.DocumentsContract.getTreeDocumentId(uri)
        val parts = docId.split(":", limit = 2)
        val volume = parts.getOrNull(0) ?: ""
        val relative = parts.getOrNull(1) ?: ""
        val root = if (volume.equals("primary", ignoreCase = true)) {
            Environment.getExternalStorageDirectory().absolutePath
        } else if (volume.isNotBlank()) {
            "/storage/$volume"
        } else {
            ""
        }
        if (root.isBlank()) "" else if (relative.isBlank()) root else "$root/$relative"
    } catch (e: Exception) {
        ""
    }

    /** Escape a string for safe injection into an evaluateJavascript() call. */
    private fun jsString(s: String): String =
        "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""

    private fun openAllFilesAccessSettings() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // Deep-link straight to OUR app's toggle. Some OEM builds don't
                // implement the per-app screen, so fall back to the global list
                // rather than throwing the user out to nothing.
                val intent = Intent(
                    Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:$packageName")
                )
                try {
                    startActivity(intent)
                } catch (e: ActivityNotFoundException) {
                    startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
                }
            } else {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE),
                    REQ_STORAGE
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "cannot open storage settings", e)
        }
    }

    private fun requestNotificationPermission() {
        // Android 13+: the foreground-service notification (and therefore the
        // media controls) is silently dropped without this.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED
        ) return
        ActivityCompat.requestPermissions(
            this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFICATIONS
        )
    }

    private companion object {
        const val TAG = "FixSpotify"
        const val REQ_NOTIFICATIONS = 1001
        const val REQ_STORAGE = 1002
    }
}
