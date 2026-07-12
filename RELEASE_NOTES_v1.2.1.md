# Fix_Spotify v1.2.1

Stability and feature pass focused on the Android app.

## Fixed
- **Search no longer crashes.** Typing in the search bar showed a blank white screen — search suggestions are now rendered correctly, and a safety net catches any render error instead of blanking the app.
- **Spotify plays the right song.** Imported Spotify tracks are matched by title *and* artist with a quality floor, so covers and same-named wrong songs are dropped instead of played.
- **Bluetooth shows the real device name** (e.g. "OnePlus Nord Buds 3r") instead of your phone's model number.
- **Playback stops when your earbuds disconnect**, using Android's native audio-becoming-noisy signal.
- **Home feed recovers on reconnect** — it keeps retrying quietly instead of getting stuck on "couldn't load".

## New
- **YouTube (Beta) now uses a real on-device JavaScript engine (QuickJS).** YouTube requires solving a JS challenge that Deno handles on desktop; Android now ships QuickJS to do the same. Off by default; enabling runs an on-device self-test and only turns on if a real video resolves. May be slower than JioSaavn.
- **Spotify playlists behave like real playlists** — like and download the whole set, just like albums.
- **Like artists**, with a new **Artists** filter in Your Library.
- **Recently played** row on Home.
- **Show Quality Badge** setting (off by default) — shows the streaming bitrate on the now-playing screen.
- **Search auto-suggestions** as you type.
- Mini-player tinted from the artwork; song / lyrics / queue and the Bluetooth device name arranged on one row.
- Delete now asks for confirmation before removing a playlist.
- Toast notifications queue and play one at a time.

## Notes
- **Source badge is now off by default.**
- Updating installs over the existing app — your playlists, liked songs, downloads and history are kept.
