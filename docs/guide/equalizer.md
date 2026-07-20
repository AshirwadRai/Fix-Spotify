# Equalizer

Eight bands, from **sub-bass (60 Hz)** to **air (16 kHz)**, with eleven presets and a custom curve.

## Presets

| | | |
| --- | --- | --- |
| Flat | Rock | Metal |
| Pop | Hip-Hop | Electronic |
| Classical | Jazz | Vocal |
| Bass Boost | Treble Boost | **Custom** |

Pick a preset, or drag the sliders and the app remembers your curve as **Custom**.

Changes are **audible immediately** — no restart, no re-buffer, no gap in the music.

## Why it sounds clean

Two decisions are doing the work here, and both look like limitations until you hear them.

### Gains are clamped to ±12 dB

A stream is already mastered near full volume. A 15 dB boost wouldn't make it louder — it would **clip and distort**, because there's no headroom left to boost into.

Staying inside the ceiling is exactly what keeps a heavy Bass Boost punchy instead of muddy. The clamp isn't a missing feature; it's the reason the preset works.

### Eight bands, not ten

On a phone, ten sliders means ten targets too small to grab accurately with a thumb.

And at these Q values, the extra two bands buy almost nothing — the frequencies they'd cover are already inside a neighbouring band's curve. Eight is where usable and useful meet.

::: tip Why it can sound stronger than your phone's built-in EQ
The equalizer runs on the audio graph inside the app, before the signal reaches the system mixer. It's shaping the stream directly rather than nudging an already-processed output — which is why the effect is more pronounced than a system-level EQ at the same nominal settings.
:::

## Where to find it

**Settings → Sound → Equalizer**, on both Windows and Android.

Your curve is stored on your device and applies to everything the app plays — streams and downloads alike.

---

Related: **[Sound & Quality](/reference/sound)** for bitrate, crossfade and volume normalisation.
