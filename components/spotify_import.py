"""
Spotify playlist/album fetch.
=============================
Reads a public Spotify playlist or album into {name, image, tracks:[{title,
artist}]} — no API key, by scraping the public embed page's __NEXT_DATA__ blob.

Pure fetch only: turning those (title, artist) pairs into playable JioSaavn/
SoundCloud tracks is the caller's job, because that needs the search service.
If Spotify changes the page shape this returns None, so the caller degrades to
"playlist not found" rather than breaking.
"""

import json
import re

import requests

_URL_RE = re.compile(
    r"open\.spotify\.com/(?:intl-[a-z]{2}/)?(playlist|album|track)/([A-Za-z0-9]+)"
)


def parse_url(url: str):
    """-> (kind, id) for a Spotify playlist/album/track URL or URI, else (None, None)."""
    if not url:
        return None, None
    m = _URL_RE.search(url)
    if m:
        return m.group(1), m.group(2)
    m = re.match(r"spotify:(playlist|album|track):([A-Za-z0-9]+)", url.strip())
    if m:
        return m.group(1), m.group(2)
    return None, None


def _norm_ws(s: str) -> str:
    # Spotify separates multiple artists with a NON-BREAKING space
    # ("Shakira,\xa0Burna Boy"); left in, it poisons the search query.
    return " ".join((s or "").replace("\xa0", " ").split())


def fetch_tracklist(kind: str, sid: str):
    """Read {name, image, tracks:[{title, artist}]} from Spotify's embed page,
    or None if it can't be read."""
    r = requests.get(
        f"https://open.spotify.com/embed/{kind}/{sid}",
        headers={
            "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
            "Accept-Language": "en",
        },
        timeout=15,
    )
    if r.status_code != 200:
        return None

    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', r.text, re.DOTALL)
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
    except Exception:
        return None

    entity = (
        data.get("props", {}).get("pageProps", {}).get("state", {})
        .get("data", {}).get("entity", {})
    )
    if not entity:
        return None

    tracks = []
    for it in entity.get("trackList") or []:
        title = _norm_ws(it.get("title"))
        if title:
            tracks.append({"title": title, "artist": _norm_ws(it.get("subtitle"))})

    # A single track has no trackList — the entity IS the song.
    if kind == "track" and not tracks:
        artist = ", ".join(
            a.get("name", "") for a in entity.get("artists") or [] if a.get("name")
        ) or _norm_ws(entity.get("subtitle"))
        if entity.get("name"):
            tracks.append({"title": _norm_ws(entity["name"]), "artist": _norm_ws(artist)})

    cover = ""
    try:
        cover = entity.get("coverArt", {}).get("sources", [{}])[0].get("url", "")
    except Exception:
        pass

    name = entity.get("name") or entity.get("title") or "Spotify playlist"
    return {"name": _norm_ws(name), "tracks": tracks, "image": cover}


if __name__ == "__main__":
    # Smoke test against a stable public playlist (Spotify's own "Today's Top Hits").
    k, i = parse_url("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")
    assert k == "playlist" and i == "37i9dQZF1DXcBWIGoYBM5M", (k, i)
    out = fetch_tracklist(k, i)
    assert out and out["tracks"], "no tracks scraped"
    print(f"OK: {out['name']} — {len(out['tracks'])} tracks; first = {out['tracks'][0]}")
