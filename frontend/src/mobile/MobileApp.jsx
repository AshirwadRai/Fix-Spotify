import { useState, useEffect, useCallback, useRef } from 'react';
import { WifiOff, Wifi, ArrowUpCircle, X } from 'lucide-react';
import { api } from '../api';
import { PlayerProvider, usePlayer } from '../store/PlayerContext';
import { DownloadsProvider } from '../store/DownloadsContext';
import { Toaster } from '../components/Toaster';

import { BottomNav } from './components/BottomNav';
import { MiniPlayer } from './components/MiniPlayer';
import { NowPlayingSheet } from './components/NowPlayingSheet';
import { TrackActionSheet } from './components/TrackActionSheet';
import { AddToPlaylistSheet } from './components/AddToPlaylistSheet';
import { SpotifyImportSheet } from './components/SpotifyImportSheet';
import { HomeTab } from './views/HomeTab';
import { SearchTab } from './views/SearchTab';
import { LibraryTab } from './views/LibraryTab';
import { SettingsTab } from './views/SettingsTab';
import { CollectionSheet } from './views/CollectionSheet';
import { TrackListSheet } from './views/TrackListSheet';
import { reportPlayback, registerTransport, registerUpdateHandlers, checkForUpdate, isAndroid } from './androidBridge';
import { ArtistPickerSheet } from './components/ArtistPickerSheet';
import { usePlayFrom } from './usePlayFrom';
import { getBestArtworkUrl, splitArtists, sameTrack } from '../utils/tracks';

function Shell() {
  const [tab, setTab] = useState('home');
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuTrack, setMenuTrack] = useState(null);
  const [menuFrom, setMenuFrom] = useState(null);             // { playlistId, playlistName } the ⋮ was opened from
  const [playlistTrack, setPlaylistTrack] = useState(null);   // "add to playlist" target
  const [spotifyUrl, setSpotifyUrl] = useState(null);         // pasted Spotify import
  const [artistChoices, setArtistChoices] = useState(null);   // multi-artist credit -> picker
  const [collection, setCollection] = useState(null);         // remote album/artist/playlist
  const [list, setList] = useState(null);                     // local liked/playlist/offline
  const [online, setOnline] = useState(navigator.onLine);
  const [justReconnected, setJustReconnected] = useState(false);
  const [update, setUpdate] = useState(null);              // { version } when newer exists
  const [updateDismissed, setUpdateDismissed] = useState(false);
  // One silent update check at launch. Available → a dismissible popup; after
  // dismissing, the Settings gear keeps a green dot so it stays findable.
  useEffect(() => {
    if (!isAndroid()) return undefined;
    const cleanup = registerUpdateHandlers({
      onResult: (res) => { if (res?.available) setUpdate(res); },
    });
    checkForUpdate();
    return cleanup;
  }, []);

  const {
    currentTrack, isPlaying, progress, duration,
    pause, resume, playNext, playPrevious, seek,
  } = usePlayer();
  const playFrom = usePlayFrom();

  // ── Android media session ───────────────────────────────────────────────
  useEffect(() => {
    reportPlayback({
      track: currentTrack,
      isPlaying,
      duration,
      position: progress,
      artwork: currentTrack ? getBestArtworkUrl(currentTrack) : '',
    });
    // `progress` is intentionally excluded: it ticks ~4x/second, and crossing the
    // JS→native bridge that often is wasteful. Android extrapolates position from
    // the playback state's timestamp, so it stays accurate between updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack, isPlaying, duration]);

  // Re-anchor the lock-screen scrubber on a SEEK. The effect above extrapolates
  // position between updates from a single anchor, which is right for normal
  // playback but WRONG the instant the user scrubs: a seek is a discontinuity
  // the OS can't predict, so without a fresh anchor the lock-screen bar keeps
  // running from the old spot (the "progress out of sync / frozen" report). We
  // detect the jump instead of streaming every tick — a normal tick moves
  // ~0.25s, so anything past ~1.2s is a seek, and only that re-crosses the bridge.
  const lastPosRef = useRef(0);
  useEffect(() => {
    const jumped = Math.abs(progress - lastPosRef.current) > 1.2;
    lastPosRef.current = progress;
    if (jumped) {
      reportPlayback({
        track: currentTrack,
        isPlaying,
        duration,
        position: progress,
        artwork: currentTrack ? getBestArtworkUrl(currentTrack) : '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  // Reopening the app restores the last song PAUSED. But a reconnecting
  // Bluetooth headset (or the lingering media notification) can fire a PLAY
  // command the instant the session comes back — which un-paused it before the
  // user touched anything. Swallow transport "play" during the first seconds
  // after launch unless the user has interacted; every later command is honoured.
  const bootAtRef = useState(() => Date.now())[0];
  useEffect(() => {
    const markTouched = () => { window.__userTouched = true; };
    window.addEventListener('pointerdown', markTouched, { once: true });
    return () => window.removeEventListener('pointerdown', markTouched);
  }, []);

  // Latest playback truth, readable from inside the transport callbacks below
  // without making them re-register on every tick.
  const liveRef = useRef(null);
  useEffect(() => {
    liveRef.current = { currentTrack, isPlaying, duration, progress };
  });

  // Re-assert the real state to Android after a transport command.
  //
  // This is what fixes "single tap does nothing, tap again and it works".
  // A headset's single tap is one keycode; Android decides whether that means
  // onPlay() or onPause() by reading the media session's CURRENT PlaybackState.
  // The service flips that state optimistically the moment it dispatches a
  // command, so any command the app does not actually carry out — most obviously
  // a "play" swallowed by the boot guard below — leaves the session inverted.
  // From then on every single tap picks the wrong branch and appears dead, until
  // a second tap flips it back. Reporting the truth shortly after each command
  // means an optimistic guess can be wrong for a moment, but never stay wrong.
  const reassert = useCallback(() => {
    setTimeout(() => {
      const s = liveRef.current;
      if (!s) return;
      reportPlayback({
        track: s.currentTrack,
        isPlaying: s.isPlaying,
        duration: s.duration,
        position: s.progress,
        artwork: s.currentTrack ? getBestArtworkUrl(s.currentTrack) : '',
      });
    }, 350); // long enough for <audio> to emit 'playing' / 'pause'
  }, []);

  // play/pause are EXPLICIT, not togglePlay. Android sends a real "pause" when the
  // headset is unplugged or the buds disconnect; routing that through a toggle
  // meant a pause arriving while already paused would START the music — out loud,
  // on the phone speaker. The commands now say what they mean.
  useEffect(
    () => registerTransport({
      play: () => {
        if (!window.__userTouched && Date.now() - bootAtRef < 4000) {
          reassert(); // we ignored it — undo the session's optimistic "playing"
          return;
        }
        resume();
        reassert();
      },
      pause: () => { pause(); reassert(); },
      next: () => { playNext(); reassert(); },
      previous: () => { playPrevious(); reassert(); },
      seek,
    }),
    [pause, resume, playNext, playPrevious, seek, bootAtRef, reassert]
  );

  // ── Connectivity ────────────────────────────────────────────────────────
  // navigator.onLine only tells us the interface is up, not that the internet is
  // truly reachable — so on an 'online' event we PROBE the backend's
  // connectivity check before declaring success. On a confirmed reconnect we
  // flash a green "back online" banner and broadcast 'app:reconnected', which
  // the data views (Home, etc.) listen for to auto-refetch — so a screen that
  // failed while offline heals itself instead of staying stuck on an error.
  useEffect(() => {
    let cancelled = false;
    const off = () => { if (!cancelled) setOnline(false); };
    const on = async () => {
      let reachable = navigator.onLine;
      try {
        const res = await api.checkConnectivity();
        reachable = !!(res && res.online);
      } catch { /* fall back to navigator.onLine */ }
      if (cancelled || !reachable) return;
      setOnline((wasOnline) => {
        if (!wasOnline) {
          setJustReconnected(true);
          setTimeout(() => setJustReconnected(false), 2500);
          window.dispatchEvent(new Event('app:reconnected'));
        }
        return true;
      });
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      cancelled = true;
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // ── Hardware Back ───────────────────────────────────────────────────────
  // MainActivity routes Back to webView.goBack(), popping one history entry.
  // Each overlay pushed one, so they peel off newest-first and the app only
  // exits once nothing is left. Order here = reverse of visual stacking.
  useEffect(() => {
    const onPop = () => {
      if (playlistTrack) { setPlaylistTrack(null); return; }
      if (menuTrack) { setMenuTrack(null); return; }
      if (nowPlayingOpen) { setNowPlayingOpen(false); return; }
      if (settingsOpen) { setSettingsOpen(false); return; }
      if (spotifyUrl) { setSpotifyUrl(null); return; }
      if (list) { setList(null); return; }
      if (collection) { setCollection(null); return; }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [playlistTrack, menuTrack, nowPlayingOpen, settingsOpen, spotifyUrl, list, collection]);

  const pushOverlay = useCallback(() => {
    try { window.history.pushState({ overlay: true }, ''); } catch { /* ignore */ }
  }, []);

  const openNowPlaying = useCallback(() => { pushOverlay(); setNowPlayingOpen(true); }, [pushOverlay]);
  const openSettings = useCallback(() => { pushOverlay(); setSettingsOpen(true); }, [pushOverlay]);
  const openMenu = useCallback((t, from = null) => {
    pushOverlay();
    setMenuFrom(from);
    setMenuTrack(t);
  }, [pushOverlay]);

  const openAddToPlaylist = useCallback((t) => {
    setMenuTrack(null);       // close the action sheet first — never stack two
    pushOverlay();
    setPlaylistTrack(t);
  }, [pushOverlay]);

  const openList = useCallback((v) => { pushOverlay(); setList(v); }, [pushOverlay]);

  const openSpotifyImport = useCallback((u) => { pushOverlay(); setSpotifyUrl(u); }, [pushOverlay]);

  // Tapping a bottom-nav destination must take you THERE — so it closes any
  // detail overlay first. Without this, the nav is visible over an open album
  // (by design), but tapping Search would leave the album covering the screen.
  const changeTab = useCallback((next) => {
    setCollection(null);
    setList(null);
    setSettingsOpen(false);
    setSpotifyUrl(null);
    setTab(next);
  }, []);

  const openCollection = useCallback((target) => {
    pushOverlay();
    setCollection(target);
  }, [pushOverlay]);

  // Callers hand us whatever the track credits — which may be several artists in
  // one string ("Diljit Dosanjh, Sia"). Splitting HERE, rather than at each call
  // site, is what guarantees we never again query the artist API for a performer
  // named "A, B". One name opens straight through; several ask which.
  const openArtist = useCallback((credit) => {
    const names = splitArtists(credit);
    if (!names.length) return;
    if (names.length > 1) {
      setArtistChoices(names);
      return;
    }
    setNowPlayingOpen(false);
    openCollection({ type: 'artist', name: names[0] });
  }, [openCollection]);

  const pickArtist = useCallback((name) => {
    setArtistChoices(null);
    setNowPlayingOpen(false);
    openCollection({ type: 'artist', name });
  }, [openCollection]);

  const openAlbum = useCallback((album) => {
    setNowPlayingOpen(false);
    openCollection({ ...album, type: album.type || 'album' });
  }, [openCollection]);

  // Route a Home card by its type. A track plays (and queues its row); an album
  // or playlist opens. Sending a track to the collection view was the "couldn't
  // load any tracks" bug — a song was being fetched as if it were an album.
  const handleHomeItem = useCallback((item, rowItems) => {
    if (!item) return;
    const type = item.type;
    const isTrack = type === 'track' || type === 'song' || !!item.track;
    // Only an album/playlist can be OPENED — it needs an identifier to fetch by.
    // Anything else that isn't explicitly a collection is treated as a track, so
    // an unrecognised playable card never falls through to a failing album
    // fetch ("couldn't load any tracks").
    const isCollection =
      type === 'album' || type === 'playlist' ||
      !!item.perma_url || !!item.album_id;

    if (isTrack || !isCollection) {
      const tracks = (rowItems || [])
        .filter((x) => x && (x.type === 'track' || x.type === 'song' || x.track || (!x.perma_url && !x.album_id && x.type !== 'album' && x.type !== 'playlist')))
        .map((x) => x.track || x);
      const self = item.track || item;
      // Callers often pass a COPY of the row item ({...t, type:'track'}), so an
      // identity indexOf misses and index 0 played instead of the tapped song.
      // Fall back to a title+artist match to find the real position.
      let idx = tracks.indexOf(self);
      if (idx < 0) idx = tracks.findIndex((x) => sameTrack(x, self));
      if (idx < 0) { playFrom([self], 0); return; }
      playFrom(tracks, idx);
      return;
    }
    // album / playlist — item carries type + perma_url / album_id for the
    // collection view to resolve it.
    openCollection({ ...item, type });
  }, [playFrom, openCollection]);

  return (
    <div className="flex flex-col h-full bg-spotify-black">
      {!online && (
        <div className="shrink-0 pt-safe bg-spotify-essential-warning text-black">
          <div className="flex items-center justify-center gap-2 py-1.5 text-xs font-medium">
            <WifiOff size={14} /> Offline — downloaded songs still play
          </div>
        </div>
      )}
      {online && justReconnected && (
        <div className="shrink-0 pt-safe bg-spotify-essential-bright-accent text-black">
          <div className="flex items-center justify-center gap-2 py-1.5 text-xs font-medium">
            <Wifi size={14} /> Back online — refreshing
          </div>
        </div>
      )}

      {/* New version available.
          A top bar, not a floating card over the player: it reads as part of the
          app chrome rather than an ad, it never covers a control, and it stays put
          instead of animating in over whatever the user was doing. Plain language,
          no emoji — the version number and a clear action are the whole pitch. */}
      {update && !updateDismissed && !settingsOpen && (
        <div className="shrink-0 pt-safe bg-spotify-elevated-base border-b border-white/10">
          <div className="flex items-center gap-3 px-4 py-2">
            <ArrowUpCircle size={17} className="shrink-0 text-spotify-essential-bright-accent" />
            <p className="min-w-0 flex-1 truncate text-[13px]">
              <span className="font-semibold">Version {update.version} is available</span>
              <span className="text-spotify-text-subdued"> · your library is kept</span>
            </p>
            <button
              type="button"
              onClick={() => { setUpdateDismissed(true); openSettings(); }}
              className="tap shrink-0 rounded-full bg-spotify-essential-bright-accent px-3.5 py-1 text-[12px] font-semibold text-black"
            >
              Update
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setUpdateDismissed(true)}
              className="tap shrink-0 p-1 text-spotify-text-subdued"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* main is the ONLY scroll region and the positioning context for the
          detail overlays. Because CollectionSheet / TrackListSheet / Settings
          render INSIDE main (absolute inset-0), the mini-player and nav below
          stay pinned and visible on every screen except the full player. */}
      <main className="flex-1 min-h-0 relative">
        <div className={tab === 'home' ? 'h-full' : 'hidden'}>
          <HomeTab onHomeItem={handleHomeItem} onOpenSettings={openSettings} updateDot={!!update} />
        </div>
        <div className={tab === 'search' ? 'h-full' : 'hidden'}>
          <SearchTab
            onMenu={openMenu}
            onOpenArtist={openArtist}
            onOpenAlbum={openAlbum}
            onImportSpotify={openSpotifyImport}
          />
        </div>
        <div className={tab === 'library' ? 'h-full' : 'hidden'}>
          <LibraryTab onOpenList={openList} onOpenCollection={openCollection} />
        </div>

        {list && (
          <TrackListSheet
            view={list}
            onClose={() => setList(null)}
            onMenu={openMenu}
          />
        )}

        {/* Collection renders AFTER (= on top of) a local list: opening an
            artist/album from inside a playlist must appear over it. It used to
            mount underneath, which read as "artist page doesn't open". */}
        {collection && (
          <CollectionSheet
            target={collection}
            onClose={() => setCollection(null)}
            onMenu={openMenu}
            onOpenArtist={openArtist}
            onOpenAlbum={openAlbum}
          />
        )}

        {spotifyUrl && (
          <SpotifyImportSheet
            url={spotifyUrl}
            onClose={() => setSpotifyUrl(null)}
            onMenu={openMenu}
          />
        )}

        {settingsOpen && (
          <div className="absolute inset-0 z-20">
            <SettingsTab onClose={() => setSettingsOpen(false)} />
          </div>
        )}

        {/* The bars FLOAT over the scroll region rather than sitting below it in
            the flex column.

            That is what makes the nav's frosted glass real. `backdrop-filter`
            blurs whatever is painted BEHIND an element — and while the bars were
            siblings of <main>, the only thing behind them was the page's solid
            black, so the blur had nothing to work on and the "glass" was a lie.
            Now the content genuinely passes underneath.

            Every scroll region inside <main> carries `pb-bars` to clear them, so
            nothing is hidden behind the glass. Sitting inside <main> (z-30, above
            the z-20 sheets) also keeps them visible on every screen except the
            full player, exactly as before.

            ABSOLUTE, anchored to <main> — NOT fixed to the viewport.

            index.mobile.html sets viewport-fit=cover, which deliberately extends
            the layout viewport BEHIND the system gesture bar so the UI can run
            edge to edge. `position: fixed` resolves against that viewport, so
            `bottom: 0` put the nav underneath the gesture bar and off the bottom
            of the screen. Anchoring to <main> instead keeps the bars inside the
            app's real flex box, where they physically cannot escape.

            (The shake this briefly tried to fix was never a positioning problem —
            it was the backdrop-filter re-compositing against the scrolling
            content. That's solved in BottomNav by promoting it to its own layer.) */}
        <div className="absolute inset-x-0 bottom-0 z-30">
          {/* Spotify's signature: the scrolling content doesn't just stop at the
              bar, it DISSOLVES into it. A short transparent-to-black gradient sits
              above the mini-player so the last rows of the list fade out as they
              approach the glass, instead of sliding under a hard edge. Purely
              decorative, so it never eats a tap. */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-full h-8 bg-gradient-to-t from-black/70 to-transparent"
            aria-hidden="true"
          />
          <MiniPlayer onExpand={openNowPlaying} />
          <BottomNav active={tab} onChange={changeTab} />
        </div>
      </main>

      {/* The full-screen immersive player DOES cover the bars — intentionally. */}
      <NowPlayingSheet
        open={nowPlayingOpen}
        onClose={() => setNowPlayingOpen(false)}
        onOpenArtist={openArtist}
        onAddToPlaylist={openAddToPlaylist}
      />

      <TrackActionSheet
        track={menuTrack}
        from={menuFrom}
        onClose={() => setMenuTrack(null)}
        onOpenArtist={openArtist}
        onOpenAlbum={openAlbum}
        onAddToPlaylist={openAddToPlaylist}
      />

      <AddToPlaylistSheet
        track={playlistTrack}
        onClose={() => setPlaylistTrack(null)}
      />

      {/* Only mounts when a credit names more than one artist. */}
      {artistChoices && (
        <ArtistPickerSheet
          artists={artistChoices}
          onPick={pickArtist}
          onClose={() => setArtistChoices(null)}
        />
      )}

      <Toaster />
    </div>
  );
}

export default function MobileApp() {
  return (
    <PlayerProvider>
      <DownloadsProvider>
        <Shell />
      </DownloadsProvider>
    </PlayerProvider>
  );
}
