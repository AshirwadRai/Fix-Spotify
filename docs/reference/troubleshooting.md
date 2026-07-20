# Troubleshooting

The handful of things that actually go wrong.

## A song won't play

It usually just falls back to another source on its own.

If it doesn't, the track may only exist on a source you have switched off — try enabling **YouTube** in **Settings → Sources**.

Some SoundCloud uploads are 30-second previews or are served in a format the player can't decode; those are skipped rather than played silently.

## The progress bar moves but there's no sound

Check your volume and that the correct output device is selected. If the song is from SoundCloud, it may be an upload the player can't decode — try the same track from another source using the row's source badge.

## Music stops when I leave the app (Android)

Check that the **Fix_Spotify notification is showing**. That's the foreground service keeping playback alive.

If it isn't there, your phone's battery optimiser killed it. Allow the app to run in the background:

**System Settings → Apps → Fix_Spotify → Battery → Unrestricted**

The exact path varies by manufacturer. Phones with aggressive power management (Xiaomi, Oppo, Vivo, Samsung) are the usual culprits.

## The lock screen controls are frozen or wrong

Seek once in the app and they re-sync.

If they stay stuck, the service was killed and restarted — see the battery optimiser answer above.

## YouTube won't turn on (Android)

The self-test resolves a real stream, and it failed on your device — usually a network block.

Try again on a different connection. The app deliberately won't enable a source it can't verify.

## Windows says the app is unsafe

The installer isn't code-signed. Choose **More info → Run anyway**.

## Windows wants WebView2 on first launch

It's a ~2 MB Microsoft runtime, and it ships with Windows 11 and recent Windows 10. Let it install.

## I lost my playlists after updating my phone

The APK was **uninstalled** rather than installed over. Android wipes app data on uninstall.

There's no recovery for this — the data is gone with the old app. Going forward, always install the new APK **on top of** the old one. See [Installation](/guide/installation).

## A download failed

Retry it. If the track exists on another source the app will usually succeed on the second attempt.

Persistent failure on one track usually means it only lives on a disabled source.

## Search returns nothing

Check your connection first. If other apps are fine, one source may be having an outage — results from the remaining sources should still appear.

---

Still stuck? Open an issue on **[GitHub](https://github.com/AshirwadRai/Fix-Spotify/issues)**.
