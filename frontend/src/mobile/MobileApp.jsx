import { useState, useEffect, useCallback } from 'react';
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

  // play/pause are EXPLICIT, not togglePlay. Android sends a real "pause" when the
  // headset is unplugged or the buds disconnect; routing that through a toggle
  // meant a pause arriving while already paused would START the music — out loud,
  // on the phone speaker. The commands now say what they mean.
  useEffect(
    () => registerTransport({
      play: () => {
        if (!window.__userTouched && Date.now() - bootAtRef < 4000) return;
        resume();
      },
      pause,
      next: playNext,
      previous: playPrevious,
      seek,
    }),
    [pause, resume, playNext, playPrevious, seek, bootAtRef]
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
  const openMenu = useCallback((t) => { pushOverlay(); setMenuTrack(t); }, [pushOverlay]);

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

            FIXED, not absolute. An absolutely-positioned backdrop-filter element
            is re-composited against the content moving behind it on every scroll
            frame, and the WebView lands those repaints a frame late — which is
            the shake that showed up on Home the moment the bar became glass.
            Fixing it to the viewport takes it out of the scroll's compositing
            path entirely, so it cannot be dragged around by the layer behind it.

            pointer-events: the wrapper spans the full width including the
            mini-player's side gutters, so it must not swallow taps that land in
            them — the bars themselves take pointer events back. */}
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30">
          <div className="pointer-events-auto">
            <MiniPlayer onExpand={openNowPlaying} />
            <BottomNav active={tab} onChange={changeTab} />
          </div>
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
