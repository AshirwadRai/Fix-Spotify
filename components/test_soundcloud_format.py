"""SoundCloud format selection. Run: python components/test_soundcloud_format.py

Both traps this guards against were found by asking SoundCloud for a real
track and looking at what came back, not by reading the code:

  * https://soundcloud.com/levity_music/tameflip offers http_mp3_128 AND
    hls_aac_160k. Picking on bitrate alone chose the HLS one, so the player
    was handed "#EXTM3U..." playlist text instead of audio.
  * https://soundcloud.com/tame-impala/the-less-i-know-the-better offers
    ONLY *_preview formats — a 29.8-second snippet of a 3:36 song.

The format dicts below are real yt-dlp output for those two tracks.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from components.soundcloud_downloader import pick_audio_format

# ── Real yt-dlp formats: a normal track ───────────────────────────────────────
TAMEFLIP = [
    {"format_id": "hls_mp3_1_0", "abr": 128, "acodec": "mp3", "vcodec": "none",
     "protocol": "m3u8_native", "ext": "mp3", "url": "https://x/playlist.m3u8"},
    {"format_id": "http_mp3_1_0", "abr": 128, "acodec": "mp3", "vcodec": "none",
     "protocol": "https", "ext": "mp3", "url": "https://x/stream.mp3"},
    {"format_id": "hls_aac_96k", "abr": 96, "acodec": "mp4a.40.2", "vcodec": "none",
     "protocol": "m3u8_native", "ext": "m4a", "url": "https://x/96.m3u8"},
    {"format_id": "hls_aac_160k", "abr": 160, "acodec": "mp4a.40.2", "vcodec": "none",
     "protocol": "m3u8_native", "ext": "m4a", "url": "https://x/160.m3u8"},
]

# ── Real yt-dlp formats: a Go+ track, preview only ────────────────────────────
PREVIEW_ONLY = [
    {"format_id": "hls_mp3_0_1_preview", "abr": 128, "acodec": "mp3", "vcodec": "none",
     "protocol": "m3u8_native", "ext": "mp3", "url": "https://x/preview.m3u8"},
    {"format_id": "http_mp3_0_1_preview", "abr": 128, "acodec": "mp3", "vcodec": "none",
     "protocol": "https", "ext": "mp3",
     "url": "https://cf-preview-media.sndcdn.com/preview/0/30/ZsqOf8SPCgcN.128.mp3?Policy=x"},
]

# The whole point: never the 160k HLS, even though it is the highest bitrate.
# <audio> cannot play a playlist, so a "better" format we can't decode is worse
# than a worse one we can.
picked = pick_audio_format(TAMEFLIP, 320)
assert picked is not None, "a plainly playable mp3 was on offer"
assert picked["format_id"] == "http_mp3_1_0", picked["format_id"]

# Preview-only means we do NOT have the track. Serving 30 seconds of a 3:36 song
# is worse than admitting it and letting the caller try JioSaavn/YouTube.
assert pick_audio_format(PREVIEW_ONLY, 320) is None
# ...including when a preview is dressed up as progressive http (it is — that is
# exactly the format we used to serve), so format_id alone can't be the test.
assert pick_audio_format([PREVIEW_ONLY[1]], 320) is None
# ...and a preview detected only by its URL, with an innocent format_id.
assert pick_audio_format(
    [{"format_id": "http_mp3_0_1", "abr": 128, "acodec": "mp3", "vcodec": "none",
      "protocol": "https", "url": "https://cf-preview-media.sndcdn.com/preview/0/30/x.mp3"}],
    320,
) is None

# HLS-only is the same story: nothing we can play.
assert pick_audio_format([f for f in TAMEFLIP if f["protocol"] == "m3u8_native"], 320) is None

# The bitrate ceiling still applies among formats we CAN play.
cheap = [
    {"format_id": "http_mp3_128", "abr": 128, "acodec": "mp3", "vcodec": "none",
     "protocol": "https", "url": "https://x/128.mp3"},
    {"format_id": "http_aac_256", "abr": 256, "acodec": "aac", "vcodec": "none",
     "protocol": "https", "url": "https://x/256.mp3"},
]
assert pick_audio_format(cheap, 320)["format_id"] == "http_aac_256"
assert pick_audio_format(cheap, 128)["format_id"] == "http_mp3_128"
# 10% tolerance — 128 is fine when the user asked for 120.
assert pick_audio_format(cheap, 120)["format_id"] == "http_mp3_128"
# Everything over the ceiling → the closest to it, not nothing and not the worst.
assert pick_audio_format(cheap, 64)["format_id"] == "http_mp3_128"

# Degenerate input must not raise.
assert pick_audio_format([], 320) is None
assert pick_audio_format(None, 320) is None
# Video formats are not audio, and a missing abr must not crash the sort.
assert pick_audio_format(
    [{"format_id": "v", "acodec": "none", "vcodec": "h264", "protocol": "https", "url": "u"}], 320
) is None
assert pick_audio_format(
    [{"format_id": "noabr", "acodec": "mp3", "vcodec": "none", "protocol": "https", "url": "u"}], 320
)["format_id"] == "noabr"

print("OK: soundcloud format selection")
