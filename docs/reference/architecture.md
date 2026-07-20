# How It Works

You don't need any of this to use the app.

It's here because people ask *"where does the music actually come from?"* — and the answer is: **your own device asks the sources directly**. Nothing goes through us, because there is no us to go through. There's no server.

## The Windows app (.exe)

```mermaid
flowchart LR
    User([You])

    subgraph APP ["Fix_Spotify.exe — one window on your PC"]
        direction LR
        UI["<b>The app window</b><br/>React interface<br/>(Tauri + WebView2)"]
        BE["<b>Local engine</b><br/>Python · FastAPI<br/>127.0.0.1:8765"]
        FF["<b>FFmpeg + Deno</b><br/>bundled — audio<br/>convert &amp; tagging"]
    end

    subgraph SRC ["Music sources — queried in parallel"]
        direction TB
        JS[("JioSaavn")]
        SC[("SoundCloud")]
        YT[("YouTube")]
    end

    subgraph META ["Details &amp; artwork"]
        direction TB
        IT[("iTunes")]
        MB[("MusicBrainz")]
        LR[("lrclib — lyrics")]
    end

    DISK[("<b>Your PC</b><br/>playlists · likes<br/>downloads")]

    User <--> UI
    UI <-->|"local HTTP"| BE
    BE --> FF
    BE -->|HTTPS| JS
    BE -->|HTTPS| SC
    BE -->|HTTPS| YT
    BE -->|HTTPS| IT
    BE -->|HTTPS| MB
    BE -->|HTTPS| LR
    BE <--> DISK

    style APP fill:#e8f5e9,stroke:#1DB954,stroke-width:2px
    style SRC fill:#f1f8e9,stroke:#7cb342
    style META fill:#f1f8e9,stroke:#7cb342
    style UI fill:#c8e6c9,stroke:#2e7d32
    style BE fill:#c8e6c9,stroke:#2e7d32
    style FF fill:#c8e6c9,stroke:#2e7d32
    style DISK fill:#dcedc8,stroke:#558b2f
```

**In one line:** the window you see and a small Python engine ship inside the same installer. The window asks the engine, the engine asks the music sources, and your library is written to your own disk.

FFmpeg and Deno come bundled — you never install them.

## The Android app (.apk)

```mermaid
flowchart LR
    User([You])
    LOCK["<b>Lock screen</b><br/>&amp; notification<br/>play · pause · skip"]

    subgraph PHONE ["Fix_Spotify.apk — everything on your phone"]
        direction LR

        subgraph ACT ["MainActivity"]
            WV["<b>The app screen</b><br/>React in a WebView<br/>+ audio player"]
        end

        subgraph SVC ["BackendService — keeps music alive in the background"]
            direction TB
            FL["<b>Local engine</b><br/>Python · Flask<br/>127.0.0.1:8765"]
            MS["<b>Media session</b><br/>lock screen, headset<br/>audio focus"]
            NP["<b>NewPipe</b><br/>YouTube, natively —<br/>no sign-in, no cookies"]
        end
    end

    subgraph SRC ["Music sources — queried in parallel"]
        direction TB
        JS[("JioSaavn")]
        SC[("SoundCloud")]
        YT[("YouTube")]
    end

    subgraph META ["Details &amp; artwork"]
        direction TB
        IT[("iTunes")]
        MB[("MusicBrainz")]
        LR[("lrclib — lyrics")]
    end

    STORE[("<b>Your phone</b><br/>playlists · likes<br/>downloads")]

    User <--> WV
    LOCK <--> MS
    MS <--> WV
    WV <-->|"JS bridge<br/>+ local HTTP"| FL
    FL --> NP
    NP -->|HTTPS| YT
    FL -->|HTTPS| JS
    FL -->|HTTPS| SC
    FL -->|HTTPS| IT
    FL -->|HTTPS| MB
    FL -->|HTTPS| LR
    FL <--> STORE

    style PHONE fill:#e8f5e9,stroke:#1DB954,stroke-width:2px
    style ACT fill:#f1f8e9,stroke:#7cb342
    style SVC fill:#f1f8e9,stroke:#7cb342
    style SRC fill:#f1f8e9,stroke:#7cb342
    style META fill:#f1f8e9,stroke:#7cb342
    style WV fill:#c8e6c9,stroke:#2e7d32
    style FL fill:#c8e6c9,stroke:#2e7d32
    style MS fill:#c8e6c9,stroke:#2e7d32
    style NP fill:#c8e6c9,stroke:#2e7d32
    style STORE fill:#dcedc8,stroke:#558b2f
    style LOCK fill:#dcedc8,stroke:#558b2f
```

**In one line:** the same interface and the same engine, packed into the APK.

Music survives you switching apps or locking the phone because the engine runs as a **foreground service** — that's the notification you see while playing, and Android requires it for background audio.

YouTube is handled by **NewPipe** directly on the device, which is why it needs no sign-in and no cookies.

## Same brain, two bodies

Both editions share **one backend and one React codebase**. A fix to search or downloads lands on your PC and your phone at the same time.

The parts that differ are only the parts that have to: how the window is created, how audio is kept alive in the background, and how YouTube is reached.

## What this means for you

- **Nothing is uploaded.** There's no account and no server, so there's nowhere to upload to.
- **Your library is a local file.** Backing up your device backs up your music library.
- **The app works as well as your connection does** — it's talking to the sources directly, not to a middle layer that might be down.

---

Related: **[Introduction](/guide/introduction)** · **[Troubleshooting](/reference/troubleshooting)**
