# Finding Music

## Search

**Search queries every enabled source in parallel** and merges the results, so one song is one row carrying every source it's available from. A badge tells you where a track is coming from.

| Source | Status | What it's good for |
| --- | --- | --- |
| **JioSaavn** | Always on | The main catalogue — up to 320 kbps |
| **SoundCloud** | Always on | Remixes, DJ sets, independent uploads |
| **YouTube** | Opt-in | Everything else — rarities, live sets, covers |

Merging is what makes the fallback behaviour possible. Because a row knows about all three sources, the player can quietly switch to another one mid-song if the first stops responding.

## Turning on YouTube

**Settings → Sources.**

On Android the app runs a **real self-test on your device** before flipping the switch — it resolves an actual audio stream, and only enables the source if that works.

This is deliberate. YouTube playback on Android depends on things that vary by device and network, so the app verifies it rather than promising it. **It will never claim YouTube works on a phone where it doesn't.**

If the self-test fails, it's usually a network block. Try again on a different connection.

## Browse tiles

The **Home** tab shows curated featured playlists from JioSaavn, themed by mood, genre and decade.

They exist for the times you want music but don't have a specific song in mind — a starting point rather than a search.

## Radio and autoplay

As your queue runs low, the app **tops it up with similar tracks**, using Last.fm's collaborative filtering and resolving each suggestion against whichever sources you have enabled.

Start with one song you like and the app keeps the mood going on its own. Turn it off in **Settings → Playback → Autoplay** if you'd rather the music simply stop at the end of the queue.

## The queue

The queue behaves the way you'd hope:

- Songs you **add by hand** form a block at the head of the queue, in the order you added them.
- **Play next** jumps that block.
- Radio suggestions fill in *after* your block, never in front of it.
- On Android you can **drag queue items** to reorder them.
- The queue **survives closing the app** — reopen and it's still there.

## Metadata

Clean names and high-resolution cover art come from the **iTunes Search API** and **MusicBrainz**.

That's why you get a proper artist, album, genre and release date instead of `Song_Name_320kbps_FINAL(2)`.

---

Next: **[The Player](/guide/player)** — the gestures worth knowing.
