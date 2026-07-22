package com.xmrnoobx.fixspotify

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import androidx.core.content.ContextCompat
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.media.app.NotificationCompat.MediaStyle
import com.chaquo.python.Python
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Hosts the Python backend and owns media playback state.
 *
 * Why a foreground service at all: the audio is played by an <audio> element
 * inside the WebView, and the HTTP server feeding it is a Python thread in this
 * same process. The moment Android decides the process is idle-in-background it
 * freezes both, and the music stops. A foreground service with a mediaPlayback
 * type is the only supported way to say "keep this process running while sound
 * is coming out of it".
 */
class BackendService : Service() {

    companion object {
        // The debug build installs ALONGSIDE the release app (separate applicationId)
        // and both keep a foreground service alive in the background, so they can
        // both be holding a loopback port at once. A shared port means whichever one
        // bound it first silently answers the other's API calls with its own token,
        // which the other app's WebView never carries — every request 403s. Different
        // ports per variant means they can never collide.
        val PORT = if (BuildConfig.DEBUG) 8766 else 8765
        val BASE_URL = "http://127.0.0.1:$PORT"

        /**
         * Per-launch secret guarding the API routes.
         *
         * (Do not write that path with a glob in a KDoc: Kotlin NESTS block
         * comments, so a slash-star opens a comment that never closes.)
         *
         * The Flask server listens on loopback, which on Android is NOT private:
         * every other app on the device can reach 127.0.0.1:8765 too. Without a
         * secret, any installed app could drive this one's API — and now that the
         * app can hold All-files access, that includes pointing its downloads at
         * an arbitrary path on shared storage.
         *
         * The token deliberately never appears in the served HTML (another app
         * could simply fetch the page and read it). It is handed to the page
         * through the JavaScript bridge, which only OUR WebView has.
         *
         * Regenerated every launch: it is a capability, not a credential, and
         * nothing needs it to survive a restart.
         */
        val API_TOKEN: String = UUID.randomUUID().toString()

        private const val TAG = "FixSpotifySvc"
        private const val CHANNEL_ID = "fixspotify_playback"
        private const val NOTIFICATION_ID = 1

        // Transport commands delivered back to this service by the notification
        // buttons (see actionIntent / onStartCommand).
        const val ACTION_PLAY_PAUSE = "com.xmrnoobx.fixspotify.PLAY_PAUSE"
        const val ACTION_NEXT = "com.xmrnoobx.fixspotify.NEXT"
        const val ACTION_PREV = "com.xmrnoobx.fixspotify.PREV"

        /** Set once the Flask server answers /health. MainActivity polls this. */
        val serverReady = AtomicBoolean(false)

        @Volatile
        var instance: BackendService? = null

        /**
         * How the service asks the WebView to change playback. Lock-screen and
         * notification buttons land here, and MainActivity turns them into calls
         * on the <audio> element.
         *
         * This lives on the COMPANION, not on the instance, and that is the whole
         * fix for "the lock screen controls work sometimes".
         *
         * MainActivity registered it as `BackendService.instance?.transportListener = …`.
         * But the activity starts the service and then immediately registers —
         * and startForegroundService() is asynchronous, so `instance` is usually
         * still null at that moment. The `?.` swallowed it, the listener was never
         * attached, and every media button (and the headset-unplug pause, which
         * comes through the same path) silently did nothing. Whether it worked
         * came down to a race: it only stuck if the service happened to win.
         *
         * A companion field has no instance to be null, so registration cannot
         * miss, and it survives the service being restarted under memory pressure.
         */
        @Volatile
        var transportListener: TransportListener? = null
    }

    interface TransportListener {
        fun onCommand(action: String)
    }

    private lateinit var mediaSession: MediaSessionCompat
    private val started = AtomicBoolean(false)

    private var trackTitle = "Fix_Spotify"
    private var trackArtist = ""
    private var isPlaying = false
    private var artwork: Bitmap? = null
    // Last position/duration the WebView reported, so an optimistic state flip
    // (below) can re-anchor the scrubber without waiting for the next report.
    private var lastDurationMs = 0L
    private var lastPositionMs = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    // ── Audio focus policy ────────────────────────────────────────────────────
    //
    // This service deliberately does NOT request audio focus. That looks like a
    // missing feature; it is the opposite. The app already holds focus — just not
    // from this class — and claiming it a second time is what broke playback.
    //
    // The page drives navigator.mediaSession (see PlayerContext), which makes
    // CHROMIUM open a media session for the WebView and request Android audio
    // focus for the <audio> element itself. Focus is tracked per LISTENER, not per
    // app, so a request from this service does not "top up" the app's claim — it
    // EVICTS Chromium's. Chromium's documented response to AUDIOFOCUS_LOSS is to
    // pause the media element. We were knocking out our own playback a beat after
    // it started, from inside the same process.
    //
    // It only reproduced on some phones because whether the WebView opens that
    // media session depends on the WebView build the device ships (a Moto G85 hit
    // it; the same APK was fine elsewhere). Chasing it in a focus handler could
    // never have worked — the pause happens inside Chromium and never travels
    // through transportListener.
    //
    // Letting Chromium own focus is also better behaviour than what we hand-rolled:
    // it pauses for a call, stops when another player starts, and DUCKS for a
    // notification chime instead of killing the song.
    //
    // BECOMING_NOISY below stays. It is a broadcast, not a focus claim, so it
    // costs nothing and Chromium does not cover it.
    //
    // Android fires it when audio is about to start blasting out of the phone
    // speaker because the headset went away (unplugged, or Bluetooth
    // disconnected). Pausing is the expected behaviour — and the only reliable
    // signal for it; there is no "buds disconnected" callback to poll for.
    private val becomingNoisy = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                dispatchTransport("pause")
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        setupMediaSession()
        ContextCompat.registerReceiver(
            this,
            becomingNoisy,
            IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )

        // Post the notification immediately: Android gives us ~5 seconds from
        // startForegroundService() to call startForeground(), and booting Python
        // takes far longer than that.
        //
        // Wrapped because ANY throw here is fatal to the whole app — that is
        // exactly how the first build died (a MediaStyle action-index crash).
        // The backend is the thing that matters; if the notification cannot be
        // built we would still rather run without media controls than not run.
        try {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(),
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                else 0
            )
        } catch (e: Exception) {
            Log.e(TAG, "startForeground failed — continuing without it", e)
        }

        if (started.compareAndSet(false, true)) {
            startPythonBackend()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Notification transport buttons come back in here as actions.
        when (intent?.action) {
            ACTION_PLAY_PAUSE -> dispatchTransport(if (isPlaying) "pause" else "play")
            ACTION_NEXT -> dispatchTransport("next")
            ACTION_PREV -> dispatchTransport("previous")
        }
        // STICKY so Android restarts the service (and the backend) if it is ever
        // killed for memory while the user is still in the app.
        return START_STICKY
    }

    /**
     * The user swiped the app away from Recents.
     *
     * If music is PLAYING we stay alive — that is the entire point of a media
     * foreground service, and killing it would cut the song off. If nothing is
     * playing there is nothing to keep alive, and the leftover notification is
     * just litter on the lock screen, so shut the whole service down and take the
     * notification with it. (stopSelf also defeats START_STICKY, so Android will
     * not resurrect us.)
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!isPlaying) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        try {
            Python.getInstance().getModule("mobile_server").callAttr("stop_server")
        } catch (e: Exception) {
            Log.w(TAG, "stop_server failed", e)
        }
        mediaSession.release()
        try { unregisterReceiver(becomingNoisy) } catch (e: Exception) { /* never registered */ }
        instance = null
        serverReady.set(false)
        super.onDestroy()
    }

    // ── Python ────────────────────────────────────────────────────────────────

    private fun startPythonBackend() {
        val webDir = extractWebAssets()

        // The app-specific external dir. Always writable with no permission, but
        // invisible in file managers and DELETED on uninstall — so it is the
        // fallback, not the destination.
        val privateDir = File(
            getExternalFilesDir(null) ?: filesDir, "Music"
        ).apply { mkdirs() }

        // The phone's real Download folder. Python prefers
        // <public>/Fix_Spotify/music and falls back to privateDir if writing
        // there is refused (i.e. All-files access not granted).
        val publicDir = Environment
            .getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            ?.absolutePath ?: ""

        thread(name = "python-backend", isDaemon = true) {
            try {
                Log.i(TAG, "starting Python backend on port $PORT")
                Python.getInstance()
                    .getModule("mobile_server")
                    .callAttr(
                        "start_server",
                        filesDir.absolutePath,
                        privateDir.absolutePath,
                        webDir.absolutePath,
                        cacheDir.absolutePath,
                        PORT,
                        publicDir,
                        API_TOKEN
                    )
                // start_server() blocks in serve_forever(); returning means shutdown.
                Log.i(TAG, "Python backend stopped")
            } catch (e: Exception) {
                Log.e(TAG, "Python backend crashed", e)
            }
        }

        // Flip serverReady as soon as /health answers, so the WebView can load.
        thread(name = "backend-health", isDaemon = true) {
            repeat(120) {                       // ~60s budget for a cold first boot
                if (pingHealth()) {
                    Log.i(TAG, "backend healthy")
                    serverReady.set(true)
                    return@thread
                }
                Thread.sleep(500)
            }
            Log.e(TAG, "backend never became healthy")
        }
    }

    private fun pingHealth(): Boolean = try {
        (URL("$BASE_URL/health").openConnection() as HttpURLConnection).run {
            connectTimeout = 1000
            readTimeout = 1000
            val ok = responseCode == 200
            disconnect()
            ok
        }
    } catch (e: Exception) {
        false
    }

    /**
     * Copy the React bundle out of the APK's assets into filesDir.
     *
     * Assets inside an APK are not real files, so Flask's send_from_directory
     * cannot read them — they have to exist on the filesystem first. Re-extracted
     * whenever versionCode changes, so an app update ships a fresh UI.
     */
    private fun extractWebAssets(): File {
        val webDir = File(filesDir, "web")
        val stamp = File(webDir, ".version")
        val version = packageManager.getPackageInfo(packageName, 0).let {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) it.longVersionCode
            else @Suppress("DEPRECATION") it.versionCode.toLong()
        }.toString()

        if (stamp.exists() && stamp.readText() == version) {
            return webDir
        }

        Log.i(TAG, "extracting web assets (version $version)")
        webDir.deleteRecursively()
        webDir.mkdirs()
        copyAssetDir("web", webDir)
        stamp.writeText(version)
        return webDir
    }

    private fun copyAssetDir(assetPath: String, target: File) {
        val children = assets.list(assetPath) ?: return
        if (children.isEmpty()) {
            // A leaf — assets.list() returns empty for files.
            assets.open(assetPath).use { input ->
                target.parentFile?.mkdirs()
                target.outputStream().use { input.copyTo(it) }
            }
            return
        }
        target.mkdirs()
        for (child in children) {
            copyAssetDir("$assetPath/$child", File(target, child))
        }
    }

    // ── Media session ─────────────────────────────────────────────────────────

    private fun setupMediaSession() {
        mediaSession = MediaSessionCompat(this, "FixSpotify").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                // Bluetooth earbuds deliver AVRCP commands straight to these
                // callbacks (NOT onMediaButtonEvent), so this is where an
                // unreliable single-tap actually lands. Logging which callback
                // fires and what state we were in tells us whether a toggle is
                // resolving to the wrong branch because our PlaybackState was
                // stale — the real cause of "tap once does nothing, tap again
                // works". `adb logcat -s BackendService | grep MEDIACB`.
                override fun onPlay() { Log.i(TAG, "MEDIACB onPlay (wasPlaying=$isPlaying)"); dispatchTransport("play") }
                override fun onPause() { Log.i(TAG, "MEDIACB onPause (wasPlaying=$isPlaying)"); dispatchTransport("pause") }
                override fun onSkipToNext() { Log.i(TAG, "MEDIACB onSkipToNext"); dispatchTransport("next") }
                override fun onSkipToPrevious() { Log.i(TAG, "MEDIACB onSkipToPrevious"); dispatchTransport("previous") }
                override fun onStop() { Log.i(TAG, "MEDIACB onStop"); dispatchTransport("pause") }
                override fun onSeekTo(pos: Long) {
                    lastPositionMs = pos
                    transportListener?.onCommand("seek:$pos")
                }

                // Diagnostic only — headsets disagree wildly about what a
                // double-press sends. Some emit MEDIA_NEXT/MEDIA_PREVIOUS,
                // others hammer HEADSETHOOK and lean on Android's timing-based
                // multi-click translation, which OEMs implement inconsistently.
                // Logging the raw event tells us which case a given pair of
                // earbuds is, instead of guessing at a mapping and breaking the
                // headsets that already work. super() is still called, so
                // behaviour is unchanged.
                override fun onMediaButtonEvent(intent: Intent): Boolean {
                    val ev = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
                    }
                    if (ev != null) {
                        Log.i(
                            TAG,
                            "MEDIABTN keyCode=${ev.keyCode} (${KeyEvent.keyCodeToString(ev.keyCode)}) " +
                                "action=${ev.action} repeat=${ev.repeatCount} " +
                                "downTime=${ev.downTime} eventTime=${ev.eventTime}"
                        )
                    }
                    return super.onMediaButtonEvent(intent)
                }
            })
            isActive = true
        }
    }

    /**
     * Called from the WebView's JS bridge whenever the track or play state
     * changes. Drives the lock-screen controls and the notification.
     */
    fun updatePlayback(
        title: String,
        artist: String,
        playing: Boolean,
        durationMs: Long,
        positionMs: Long,
        artworkUrl: String?
    ) {
        trackTitle = title.ifBlank { "Fix_Spotify" }
        trackArtist = artist
        isPlaying = playing
        lastDurationMs = durationMs
        lastPositionMs = positionMs

        // No audio-focus request here — Chromium already holds focus for the
        // <audio> element and a second claim from this process evicts it. See the
        // note above audioManager().

        mediaSession.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, trackTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, trackArtist)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
                .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork)
                .build()
        )

        applyPlaybackState(playing, positionMs)

        // Artwork is fetched off the main thread, then the notification is
        // rebuilt so the cover appears on the lock screen.
        if (!artworkUrl.isNullOrBlank()) {
            thread(isDaemon = true) {
                loadArtwork(artworkUrl)?.let {
                    artwork = it
                    notifyPlayback()
                }
            }
        }
        notifyPlayback()
    }

    /** Publish the media-session playback state. Speed is 0f while paused so OEM
     *  lock screens stop the scrubber dead instead of creeping it forward. */
    private fun applyPlaybackState(playing: Boolean, positionMs: Long) {
        // Revive the session if the OS deactivated it while we were idle — an
        // inactive session shows no lock-screen controls at all.
        if (!mediaSession.isActive) mediaSession.isActive = true
        mediaSession.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or
                        PlaybackStateCompat.ACTION_PAUSE or
                        PlaybackStateCompat.ACTION_PLAY_PAUSE or
                        PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                        PlaybackStateCompat.ACTION_SEEK_TO
                )
                .setState(
                    if (playing) PlaybackStateCompat.STATE_PLAYING
                    else PlaybackStateCompat.STATE_PAUSED,
                    positionMs,
                    if (playing) 1.0f else 0.0f
                )
                .build()
        )
    }

    /**
     * A transport command from a HARDWARE source — a Bluetooth button, a car
     * head unit, the lock screen. Reflect the new state IMMEDIATELY, then let the
     * WebView actually do it and confirm via updatePlayback().
     *
     * Without the optimistic flip, the earbud/car display only updates after the
     * full native → JS → <audio> → native round trip (100–300ms), which reads as
     * laggy — and worse, a stale state makes Android route the next
     * PLAY_PAUSE keypress to the wrong handler ("press pause, nothing happens").
     * The flip costs nothing: the next real report overwrites it a beat later.
     */
    private fun dispatchTransport(action: String) {
        when (action) {
            "play" -> { isPlaying = true; applyPlaybackState(true, lastPositionMs); notifyPlayback() }
            "pause" -> { isPlaying = false; applyPlaybackState(false, lastPositionMs); notifyPlayback() }
        }
        transportListener?.onCommand(action)
    }

    private fun loadArtwork(url: String): Bitmap? = try {
        URL(url).openStream().use { BitmapFactory.decodeStream(it) }
    } catch (e: Exception) {
        null
    }

    private fun notifyPlayback() {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIFICATION_ID, buildNotification())
        } catch (e: Exception) {
            // Never let a notification problem take playback down with it.
            Log.e(TAG, "notify failed", e)
        }
    }

    /** PendingIntent that re-enters this service with the given ACTION_* command. */
    private fun actionIntent(action: String): PendingIntent = PendingIntent.getService(
        this,
        action.hashCode(),
        Intent(this, BackendService::class.java).setAction(action),
        PendingIntent.FLAG_IMMUTABLE
    )

    private fun buildNotification(): Notification {
        val contentIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(trackTitle)
            .setContentText(trackArtist)
            .setSmallIcon(R.drawable.ic_notification)
            .setLargeIcon(artwork)
            .setContentIntent(contentIntent)
            .setOngoing(isPlaying)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            // These three actions are NOT optional decoration. MediaStyle's
            // setShowActionsInCompactView() takes INDEXES into this action list —
            // referencing index 0 with no actions added throws
            // IndexOutOfBoundsException while the system inflates the
            // notification, which kills the service and takes the app down.
            .addAction(R.drawable.ic_prev, "Previous", actionIntent(ACTION_PREV))
            .addAction(
                if (isPlaying) R.drawable.ic_pause else R.drawable.ic_play,
                if (isPlaying) "Pause" else "Play",
                actionIntent(ACTION_PLAY_PAUSE)
            )
            .addAction(R.drawable.ic_next, "Next", actionIntent(ACTION_NEXT))
            .setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Playback",
            NotificationManager.IMPORTANCE_LOW    // silent — it's a transport bar
        ).apply {
            description = "Media controls and the on-device music backend"
            setShowBadge(false)
        }
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .createNotificationChannel(channel)
    }
}
