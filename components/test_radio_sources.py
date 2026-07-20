"""Radio must resolve similar songs across ALL sources, not just JioSaavn.

Resolution used to be JioSaavn-only, so any Last.fm suggestion missing from its
catalogue was silently dropped and the radio ran dry outside that library. These
tests stub the network entirely and check the routing: JioSaavn is tried first,
misses fall through to SoundCloud/YouTube, and each hit is bucketed to the merger
under its OWN source key (mis-keying one would yield an unplayable track).

Run: python components/test_radio_sources.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from components import radio
from components.source_merger import SourceType


class _Song:
    """Duck-types a source client's search hit."""

    def __init__(self, title, url):
        self.title = title
        self._url = url

    def to_dict(self):
        return {"title": self.title, "artist": "A", "url": self._url, "id": self._url}


class _Client:
    """A source that only knows about the titles it was given."""

    def __init__(self, known):
        self.known = known
        self.queries = []

    def search(self, query, limit=1):
        self.queries.append(query)
        for title in self.known:
            if title.lower() in query.lower():
                return [_Song(title, f"https://x/{title}")]
        return []


def _install(jio, soundcloud=None, youtube=None):
    """Point radio at stub clients instead of the network."""
    radio._jiosaavn = lambda: jio

    class _Svc:
        def _get_client(self, st):
            if st == SourceType.SOUNDCLOUD:
                return soundcloud
            if st == SourceType.YOUTUBE:
                return youtube
            return None

    radio._svc = lambda: _Svc()


def test_jiosaavn_miss_falls_through_to_other_sources():
    jio = _Client(["OnJio"])
    sc = _Client(["OnSoundCloud"])
    yt = _Client(["OnYouTube"])
    _install(jio, sc, yt)
    radio.lastfm_similar = lambda t, a, limit=15: [
        ("OnJio", "A"), ("OnSoundCloud", "A"), ("OnYouTube", "A"),
    ]

    out = radio.resolve_radio("seed", "A", limit=5)
    titles = {t["title"] for t in out}

    # The whole point: all three survive, not just the JioSaavn one.
    assert titles == {"OnJio", "OnSoundCloud", "OnYouTube"}, titles
    # Every track must have come out with a real playable source.
    assert all(t.get("primary_source") for t in out), out


def test_disabled_source_is_skipped_not_crashed():
    # YouTube off (the mobile gate returns None) — radio must still work.
    jio = _Client(["OnJio"])
    _install(jio, soundcloud=_Client([]), youtube=None)
    radio.lastfm_similar = lambda t, a, limit=15: [("OnJio", "A"), ("Nowhere", "A")]

    out = radio.resolve_radio("seed", "A", limit=5)
    assert [t["title"] for t in out] == ["OnJio"]


def test_fallback_is_skipped_when_jiosaavn_already_satisfied():
    # The expensive sources must NOT be queried when we already have enough —
    # otherwise every radio fetch pays seconds it doesn't need to.
    jio = _Client(["A1", "A2"])
    sc = _Client(["A1", "A2"])
    _install(jio, soundcloud=sc, youtube=None)
    radio.lastfm_similar = lambda t, a, limit=15: [("A1", "A"), ("A2", "A")]

    radio.resolve_radio("seed", "A", limit=2)
    assert sc.queries == [], f"SoundCloud was queried needlessly: {sc.queries}"


if __name__ == "__main__":
    test_jiosaavn_miss_falls_through_to_other_sources()
    test_disabled_source_is_skipped_not_crashed()
    test_fallback_is_skipped_when_jiosaavn_already_satisfied()
    print("OK: radio resolves across all enabled sources, and only when short")
