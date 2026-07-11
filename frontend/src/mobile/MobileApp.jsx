import { useState, useEffect, useCallback } from 'react';
import { WifiOff } from 'lucide-react';
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
import { DownloadsTab } from './views/DownloadsTab';
import { SettingsTab } from './views/SettingsTab';
import { CollectionSheet } from './views/CollectionSheet';
import { TrackListSheet } from './views/TrackListSheet';
import { reportPlayback, registerTransport } from './androidBridge';
import { ArtistPickerSheet } from './components/ArtistPickerSheet';
import { usePlayFrom } from './usePlayFrom';
import { getBestArtworkUrl, splitArtists } from '../utils/tracks';

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

  const {
    currentTrack, isPlaying, progress, duration,
    togglePlay, playNext, playPrevious, seek,
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

  useEffect(
    () => registerTransport({
      play: togglePlay,
      pause: togglePlay,
      next: playNext,
      previous: playPrevious,
      seek,
    }),
    [togglePlay, playNext, playPrevious, seek]
  );

  // ── Connectivity ────────────────────────────────────────────────────────
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
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
      const idx = Math.max(0, tracks.indexOf(self));
      playFrom(tracks.length ? tracks : [self], idx);
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

      {/* main is the ONLY scroll region and the positioning context for the
          detail overlays. Because CollectionSheet / TrackListSheet / Settings
          render INSIDE main (absolute inset-0), the mini-player and nav below
          stay pinned and visible on every screen except the full player. */}
      <main className="flex-1 min-h-0 relative">
        <div className={tab === 'home' ? 'h-full' : 'hidden'}>
          <HomeTab onHomeItem={handleHomeItem} onOpenSettings={openSettings} />
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
        <div className={tab === 'downloads' ? 'h-full' : 'hidden'}>
          <DownloadsTab onMenu={openMenu} />
        </div>

        {collection && (
          <CollectionSheet
            target={collection}
            onClose={() => setCollection(null)}
            onMenu={openMenu}
            onOpenArtist={openArtist}
            onOpenAlbum={openAlbum}
          />
        )}

        {list && (
          <TrackListSheet
            view={list}
            onClose={() => setList(null)}
            onMenu={openMenu}
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
      </main>

      <MiniPlayer onExpand={openNowPlaying} />
      <BottomNav active={tab} onChange={changeTab} />

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
