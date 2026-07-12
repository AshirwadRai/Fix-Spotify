package com.xmrnoobx.fixspotify

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * In-app updates for the sideloaded APK.
 *
 * Why this exists: the app is not on Play Store, so nothing updates it. Users
 * would have to notice a new release, download an APK, and install it by hand.
 *
 * The important part is that this is an *update*, not a reinstall. Android only
 * treats a new APK as an update when the applicationId AND the signing key match
 * the installed one — and an update keeps the app's data directory, which is
 * where the WebView stores localStorage (playlists, likes, history, resume
 * point). Uninstall-then-install is what wipes all of that. Hence the stable
 * release keystore in build.gradle; with it, updating is lossless.
 */
object Updater {

    private const val TAG = "FixSpotifyUpd"
    private const val RELEASES_API =
        "https://api.github.com/repos/AshirwadRai/Fix-Spotify/releases/latest"

    data class Release(val version: String, val apkUrl: String, val notes: String)

    /**
     * Ask GitHub for the latest release. Returns null when we're already current,
     * offline, or the release has no APK attached. Never throws — a failed update
     * check must never disturb playback.
     *
     * Runs network I/O, so call it off the main thread.
     */
    fun check(context: Context): Release? = try {
        val conn = (URL(RELEASES_API).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8000
            readTimeout = 8000
            setRequestProperty("Accept", "application/vnd.github+json")
        }
        if (conn.responseCode != 200) {
            null
        } else {
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            conn.disconnect()

            val tag = json.optString("tag_name").removePrefix("v")
            val assets = json.optJSONArray("assets")
            var apkUrl = ""
            if (assets != null) {
                for (i in 0 until assets.length()) {
                    val a = assets.getJSONObject(i)
                    if (a.optString("name").endsWith(".apk", ignoreCase = true)) {
                        apkUrl = a.optString("browser_download_url")
                        break
                    }
                }
            }

            val installed = context.packageManager
                .getPackageInfo(context.packageName, 0).versionName ?: "0"

            if (apkUrl.isNotBlank() && isNewer(tag, installed)) {
                Release(tag, apkUrl, json.optString("body"))
            } else {
                null
            }
        }
    } catch (e: Exception) {
        Log.w(TAG, "update check failed", e)
        null
    }

    /** Semantic-ish compare: "1.10.0" must beat "1.9.0", so compare numerically. */
    internal fun isNewer(remote: String, installed: String): Boolean {
        fun parts(v: String) = v.trim().split(".", "-")
            .mapNotNull { it.takeWhile(Char::isDigit).toIntOrNull() }
        val r = parts(remote)
        val i = parts(installed)
        for (n in 0 until maxOf(r.size, i.size)) {
            val a = r.getOrElse(n) { 0 }
            val b = i.getOrElse(n) { 0 }
            if (a != b) return a > b
        }
        return false
    }

    /**
     * Download the APK and hand it to Android's package installer. The user still
     * confirms the install — we cannot (and should not) do it silently.
     *
     * `onProgress` gets 0..100, or -1 on failure.
     */
    fun downloadAndInstall(context: Context, release: Release, onProgress: (Int) -> Unit) {
        try {
            val out = File(context.cacheDir, "update.apk")
            if (out.exists()) out.delete()

            val conn = (URL(release.apkUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15000
                readTimeout = 30000
                instanceFollowRedirects = true
            }
            val total = conn.contentLength.toLong()
            var read = 0L

            conn.inputStream.use { input ->
                out.outputStream().use { output ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        output.write(buf, 0, n)
                        read += n
                        if (total > 0) onProgress(((read * 100) / total).toInt())
                    }
                }
            }
            conn.disconnect()
            onProgress(100)

            // A file:// URI would throw FileUriExposedException on API 24+; the
            // installer needs a content:// URI it has been granted read access to.
            val uri: Uri = FileProvider.getUriForFile(
                context, "${context.packageName}.fileprovider", out
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "update download failed", e)
            onProgress(-1)
        }
    }
}
