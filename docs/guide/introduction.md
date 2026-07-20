# Introduction

Fix_Spotify searches **JioSaavn**, **SoundCloud** and **YouTube** at the same time, merges everything into one clean list, and lets you play or download any of it.

It runs on Windows and Android, from the same codebase.

## What makes it different

The app is not a wrapper around one music service. It queries several at once and treats the results as one catalogue.

- **No account.** Nothing to sign up for, nothing to log into.
- **No server.** Everything runs on your own device — your PC or your phone asks the sources directly.
- **No telemetry.** Your library and your listening stay on your machine.
- **One song, one row.** If a track exists on three sources, you see it once. The app quietly keeps the other two.

## The part people actually notice

That last point is the one that changes how the app feels day to day.

When a stream dies, is region-blocked, or turns out to be DRM-locked, the app **falls back to the next source** instead of showing you an error. The song keeps playing and you usually never find out anything went wrong.

This is also why an imported playlist keeps working months later — each track carries its alternates, so one source going dark doesn't punch holes in your library.

## Two apps, one codebase

| | Windows | Android |
| --- | --- | --- |
| Ships as | `.exe` installer | `.apk` |
| Interface | React in a Tauri window | React in a WebView |
| Engine | Python · FastAPI | Python · Flask |
| YouTube via | bundled tooling | NewPipe, natively |

Both editions share one backend and one React interface. A fix to search or downloads lands on your PC and your phone at the same time.

If you want the full picture of how the pieces connect, that's on **[How It Works](/reference/architecture)** — but you don't need any of it to use the app.

## Where to go next

- **[Installation](/guide/installation)** — get the app onto your device.
- **[Quick Start](/guide/quick-start)** — first search to first download in a few minutes.
- **[Finding Music](/guide/finding-music)** — how search, browse and radio actually behave.
