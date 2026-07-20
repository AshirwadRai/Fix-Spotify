# The Player

This is the page where the app stops feeling like a search box.

## Double-tap to skip forward or back

Open the full player (tap the mini player to expand it), then **double-tap the artwork**:

- **Left half** → back 10 seconds
- **Right half** → forward 10 seconds

Keep tapping while the ripple is still on screen and it **stacks**: `−10 → −20 → −30`. Single taps count once the chain has started, so you don't have to keep double-tapping.

A soft half-disc lights up from the tapped edge and shows the running total, YouTube-style.

> That intro you always skip is two taps away.

## Swipe the mini player to change song

On the mini player at the bottom, **swipe left for the next song, right for the previous one**. No need to expand anything or aim for a small button.

The bar works out whether you meant to swipe sideways or scroll the page from the first few pixels of movement, then commits — so it fires reliably even if your thumb drifts.

## The scrubber

Drag to seek. The played portion fills ahead of the handle so you can see position at a glance.

Seeking also re-syncs the lock screen and Bluetooth controls, which matters more than it sounds — see below.

## Lock screen, notification and Bluetooth (Android)

While music is playing, Fix_Spotify shows a **notification with transport controls**, and the same controls appear on your lock screen and on Bluetooth devices, car head units and headsets.

- Play, pause, skip and the scrubber all work from there.
- The notification is what **keeps music alive when you leave the app** — Android requires a foreground service for background audio, and that notification is it.
- **Close the app and the notification goes away** with it.

If music stops when you switch apps, your phone's battery optimiser probably killed the service. See [Troubleshooting](/reference/troubleshooting#music-stops-when-i-leave-the-app-android).

## Resume

The app reopens on the song and timestamp you left, **paused**. Your queue comes back with it.

Paused rather than playing is intentional — an app that starts blasting audio the moment you open it is an app you stop opening in public.

## Long-press a track (Android)

Long-press any row for its menu:

- Add to playlist
- Play next
- Download
- Go to artist
- Remove from this playlist

**Multiple artists?** Tap the artist name and pick which one to open.

---

Next: **[Equalizer](/guide/equalizer)**.
