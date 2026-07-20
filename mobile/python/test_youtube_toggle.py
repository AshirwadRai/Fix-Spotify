"""The YouTube source is gated by THREE switches that must move together.

Two of them were flipped by hand at three call sites and the third was forgotten,
so search would query YouTube, get hits, and then drop every YouTube-only track on
the way out — "YouTube is on but no song ever shows a YouTube badge".

Run: python mobile/python/test_youtube_toggle.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import mobile_server as ms
from components.source_merger import SourceType


class _FakeSource:
    """Duck-types the merger's source entry: a .value and a url."""

    def __init__(self, value, url):
        self.value = value
        self._url = url

    def to_dict(self):
        return {"url": self._url}


class _FakeTrack:
    def __init__(self, source_name):
        src = _FakeSource(source_name, f"https://{source_name}.test/song")
        self.primary_source = src
        self.sources = {src: src}


def _playable(source_name):
    return ms._playable_source_name(_FakeTrack(source_name))


def test_off_by_default():
    assert ms._youtube_enabled is False
    assert _playable("youtube") is None, "YouTube must not be playable while off"
    assert _playable("jiosaavn") == "jiosaavn"


def test_enabling_syncs_all_three_switches():
    ms._set_youtube(True)
    assert ms._youtube_enabled is True
    assert SourceType.YOUTUBE in ms.PLAYABLE_SEARCH_SOURCES, "search would never ask YouTube"
    assert "youtube" in ms.PLAYABLE_SOURCES, "the bug: hits get dropped on the way out"
    # The end-to-end consequence, which is what the user actually sees:
    assert _playable("youtube") == "youtube", "a YouTube track must survive to the UI"


def test_disabling_reverts_all_three():
    ms._set_youtube(True)
    ms._set_youtube(False)
    assert ms._youtube_enabled is False
    assert SourceType.YOUTUBE not in ms.PLAYABLE_SEARCH_SOURCES
    assert "youtube" not in ms.PLAYABLE_SOURCES
    assert _playable("youtube") is None
    # Turning YouTube off must not take the real sources down with it.
    assert _playable("jiosaavn") == "jiosaavn"


if __name__ == "__main__":
    test_off_by_default()
    test_enabling_syncs_all_three_switches()
    test_disabling_reverts_all_three()
    print("OK: youtube toggle keeps all three switches in sync")
