import { useState, useCallback, useEffect, useRef } from 'react';
import { PlayerProvider, usePlayer } from './store/PlayerContext';
import { DownloadsProvider } from './store/DownloadsContext';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { SearchView } from './components/SearchView';
import { HomeView } from './components/HomeView';
import { QueueView } from './components/QueueView';
import { LikedSongsView } from './components/LikedSongsView';
import { LibraryView } from './components/LibraryView';
import { PlaylistView } from './components/PlaylistView';
import { ArtistView } from './components/ArtistView';
import { AlbumView } from './components/AlbumView';
import { SettingsView } from './components/SettingsView';
import { DownloadsView } from './components/DownloadsView';
import { NowPlayingPanel } from './components/NowPlayingPanel';
import { PlayerBar } from './components/PlayerBar';
import { api } from './api';
import { normalizeTracks, applyEnrichment } from './utils/tracks';
import { addRecentSearch } from './utils/searchHistory';
import { WifiOff } from 'lucide-react';
import { Toaster } from './components/Toaster';

function AppContent() {
  const [activeView, setActiveView] = useState('home');
  // Target for artist/album profile pages: { type, name, artist }
  const [profileTarget, setProfileTarget] = useState(null);
  const [results, setResults] = useState([]);
  const [artistResults, setArtistResults] = useState([]); // real artists for the search page
  const [albumResults, setAlbumResults] = useState([]); // real albums for the search page
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(null); // null | 'network' | string
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResetToken, setSearchResetToken] = useState(0);
  const [dynamicColor, setDynamicColor] = useState('18, 18, 18');
  const [showNowPlaying, setShowNowPlaying] = useState(false);
  // Bumped on ANY library change (likes, playlist adds/removes, etc.)
  // so all subscribers (sidebar, views) re-read from localStorage
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const { currentTrack } = usePlayer();

  // Keep the latest view in a ref so stable callbacks can read it without
  // being re-created (used to avoid stacking duplicate history entries).
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;

  // ─── Browser / device Back-Forward integration ──────────────────────────
  // The app routes via internal state. Without syncing the History API, the
  // device/browser Back button has nothing to pop and leaves the page entirely
  // (the app appears to "exit"). We make the browser History API the single
  // source of truth: every navigation pushes one entry, popstate restores the
  // view, and the in-app Topbar arrows just drive window.history back/forward.
  const histPosRef = useRef(0);   // our position in the history stack
  const histMaxRef = useRef(0);   // furthest position reached (for canForward)
  const [navState, setNavState] = useState({ canBack: false, canForward: false });

  const pushHistory = useCallback((view, target = null) => {
    const idx = histPosRef.current + 1;
    histPosRef.current = idx;
    histMaxRef.current = idx;  // a new push truncates any forward entries
    try { window.history.pushState({ view, target, idx }, ''); } catch { /* ignore */ }
    setNavState({ canBack: idx > 0, canForward: false });
  }, []);

  useEffect(() => {
    // Seed the initial entry so the very first Back press lands on Home
    // instead of unloading the app.
    try { window.history.replaceState({ view: 'home', target: null, idx: 0 }, ''); } catch { /* ignore */ }
    const onPop = (e) => {
      const st = (e && e.state) || { view: 'home', target: null, idx: 0 };
      const idx = st.idx || 0;
      histPosRef.current = idx;
      if (idx > histMaxRef.current) histMaxRef.current = idx;
      setActiveView(st.view || 'home');
      setProfileTarget(st.target || null);
      setNavState({ canBack: idx > 0, canForward: idx < histMaxRef.current });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const goBack = useCallback(() => { try { window.history.back(); } catch { /* ignore */ } }, []);
  const goForward = useCallback(() => { try { window.history.forward(); } catch { /* ignore */ } }, []);

  // Track online/offline status globally
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const bumpLibrary = useCallback(() => {
    setLibraryVersion(v => v + 1);
  }, []);

  const handleSearch = useCallback(async (query) => {
    if (!query.trim()) return;
    addRecentSearch(query);
    // Push a history entry when entering search from another view, so Back
    // returns to where the user was (not out of the app).
    if (activeViewRef.current !== 'search') pushHistory('search', null);
    setSearchQuery(query);
    setActiveView('search');
    setProfileTarget(null);
    setLoading(true);
    setSearchError(null);
    setArtistResults([]);
    setAlbumResults([]);
    // Real artists & albums for their sections — fetched once per search (in App
    // state, so switching tabs / opening a profile and coming back does NOT
    // re-fetch them; results already persisted the same way).
    api.searchArtists(query).then(list => setArtistResults(list || [])).catch(() => {});
    api.searchAlbums(query).then(list => setAlbumResults(list || [])).catch(() => {});
    try {
      const data = await api.search(query, { limit: 20 });
      const tracks = normalizeTracks(data.results || []);
      // If we got zero results, it could be genuinely no matches OR no internet.
      // Probe connectivity to tell the difference (navigator.onLine is unreliable —
      // it stays true when connected to a router with no actual internet).
      if (tracks.length === 0) {
        const online = await api.checkConnectivity();
        if (!online) {
          setSearchError('network');
          setResults([]);
          return;
        }
      }
      // Show results immediately
      setResults(tracks);

      // Progressively enrich metadata (clean artist/album/artwork) without
      // blocking the initial render. Update state once enrichment returns.
      if (tracks.length > 0) {
        api.enrichBatch(tracks).then(enrichments => {
          if (!Array.isArray(enrichments)) return;
          let changed = false;
          const merged = tracks.map((t, i) => {
            if (enrichments[i]) { changed = true; return applyEnrichment(t, enrichments[i]); }
            return t;
          });
          // Only update if this is still the active search (avoid stale overwrite)
          if (changed) {
            setResults(prev => (prev === tracks ? merged : prev));
          }
        }).catch(() => { /* enrichment is best-effort */ });
      }
    } catch (error) {
      console.error('Search error:', error);
      // Any thrown error here is almost always connectivity-related
      const online = await api.checkConnectivity();
      setSearchError(online ? (error.message || 'Search failed') : 'network');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [pushHistory]);

  const handleNavigate = useCallback((view) => {
    // Opening Search via the nav (sidebar item or focusing the box from another
    // view) resets to the landing — Spotify shows Browse/recent, not the last
    // results. Back/Forward (popstate) and an actual search don't go through
    // here, so they still restore / show results.
    // ponytail ceiling: results aren't stored per history entry, so pressing
    // Back to an OLDER search after a reset lands on the landing, not those old
    // results — acceptable; full restore would need per-entry result snapshots.
    if (view === 'search') {
      setResults([]);
      setArtistResults([]);
      setAlbumResults([]);
      setSearchQuery('');
      setSearchError(null);
      setSearchResetToken(t => t + 1);
    }
    setActiveView(view);
    setProfileTarget(null);
    pushHistory(view, null);
  }, [pushHistory]);

  // Open artist / album profile pages. The activeView string carries the name
  // only to key the view-enter animation + re-render; the data lives in
  // profileTarget (avoids encoding names with special chars into the route).
  const openArtist = useCallback((name) => {
    if (!name) return;
    const target = { type: 'artist', name };
    setProfileTarget(target);
    setActiveView(`artist:${name}`);
    pushHistory(`artist:${name}`, target);
  }, [pushHistory]);

  const openAlbum = useCallback((name, artist, songUrl, albumId) => {
    if (!name) return;
    const target = { type: 'album', name, artist: artist || '', songUrl: songUrl || '', albumId: albumId || '' };
    setProfileTarget(target);
    setActiveView(`album:${name}`);
    pushHistory(`album:${name}`, target);
  }, [pushHistory]);

  // Open a JioSaavn playlist/chart (resolved to a playable tracklist, rendered
  // by AlbumView in playlist mode). Distinct route from the local user
  // playlists ('playlist:ID' → PlaylistView).
  const openPlaylist = useCallback((name, url) => {
    if (!url) return;
    const target = { type: 'jsplaylist', name: name || 'Playlist', url };
    setProfileTarget(target);
    setActiveView(`jsplaylist:${name}`);
    pushHistory(`jsplaylist:${name}`, target);
  }, [pushHistory]);

  const renderMainContent = () => {
    // Handle playlist:ID routes
    if (activeView.startsWith('playlist:')) {
      const playlistId = activeView.split(':')[1];
      return <PlaylistView playlistId={playlistId} onNavigate={handleNavigate} onLibraryChange={bumpLibrary} onSearch={handleSearch} onOpenArtist={openArtist} onOpenAlbum={openAlbum} />;
    }

    // Artist / album profile pages (data carried in profileTarget)
    if (activeView.startsWith('artist:') && profileTarget?.type === 'artist') {
      return <ArtistView key={profileTarget.name} name={profileTarget.name} onOpenArtist={openArtist} onOpenAlbum={openAlbum} onLibraryChange={bumpLibrary} />;
    }
    if (activeView.startsWith('album:') && profileTarget?.type === 'album') {
      return <AlbumView key={`${profileTarget.name}|${profileTarget.artist}|${profileTarget.songUrl || ''}|${profileTarget.albumId || ''}`} name={profileTarget.name} artist={profileTarget.artist} songUrl={profileTarget.songUrl} albumId={profileTarget.albumId} onOpenArtist={openArtist} onLibraryChange={bumpLibrary} />;
    }
    if (activeView.startsWith('jsplaylist:') && profileTarget?.type === 'jsplaylist') {
      return <AlbumView key={profileTarget.url} name={profileTarget.name} playlistUrl={profileTarget.url} onOpenArtist={openArtist} onLibraryChange={bumpLibrary} />;
    }

    switch (activeView) {
      case 'home':
        return <HomeView onSearch={handleSearch} onNavigate={handleNavigate} onOpenAlbum={openAlbum} onOpenPlaylist={openPlaylist} />;
      case 'search':
        return <SearchView results={results} artistResults={artistResults} albumResults={albumResults} loading={loading} searchError={searchError} searchQuery={searchQuery} onLikeChange={bumpLibrary} onSearch={handleSearch} onOpenArtist={openArtist} onOpenAlbum={openAlbum} onOpenPlaylist={openPlaylist} />;
      case 'queue':
        return <QueueView onLibraryChange={bumpLibrary} onOpenArtist={openArtist} onOpenAlbum={openAlbum} />;
      case 'liked':
        return <LikedSongsView onLikeChange={bumpLibrary} onSearch={handleSearch} onOpenArtist={openArtist} onOpenAlbum={openAlbum} />;
      case 'library':
        return <LibraryView libraryVersion={libraryVersion} onNavigate={handleNavigate} onOpenAlbum={openAlbum} onOpenPlaylist={openPlaylist} onOpenArtist={openArtist} onLikeChange={bumpLibrary} />;
      case 'settings':
        return <SettingsView />;
      case 'downloads':
        return <DownloadsView />;
      default:
        return <HomeView onSearch={handleSearch} onNavigate={handleNavigate} />;
    }
  };

  return (
    <div className="h-screen w-full flex flex-col bg-black overflow-hidden text-white font-sans">
      {/* Global offline banner */}
      {!isOnline && (
        <div className="flex items-center justify-center gap-2 bg-spotify-essential-warning text-black text-sm font-semibold py-1.5 px-4 shrink-0 z-[100]">
          <WifiOff className="w-4 h-4" />
          <span>No internet connection — please reconnect to search and play music</span>
        </div>
      )}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar activeView={activeView} onNavigate={handleNavigate} likedVersion={libraryVersion} onOpenAlbum={openAlbum} onOpenPlaylist={openPlaylist} />
        
        <div
          className="flex-1 flex flex-col rounded-lg overflow-hidden m-2 ml-0 relative"
          style={{
            '--dynamic-color': dynamicColor,
            background: `linear-gradient(rgba(${dynamicColor}, 0.35) 0%, var(--color-spotify-base) 40%)`,
            transition: 'background 1s ease',
          }}
        >
          <Topbar 
            onSearch={handleSearch} 
            activeView={activeView} 
            onNavigate={handleNavigate}
            resetToken={searchResetToken}
            canGoBack={navState.canBack}
            canGoForward={navState.canForward}
            onBack={goBack}
            onForward={goForward}
          />
          <div key={activeView} className="view-enter flex-1 flex flex-col overflow-hidden">
            {renderMainContent()}
          </div>
        </div>

        {showNowPlaying && currentTrack && (
          <NowPlayingPanel onClose={() => setShowNowPlaying(false)} onLikeChange={bumpLibrary} onOpenArtist={openArtist} onOpenAlbum={openAlbum} />
        )}
      </div>
      
      <PlayerBar 
        onColorChange={setDynamicColor} 
        showNowPlaying={showNowPlaying}
        onToggleNowPlaying={() => setShowNowPlaying(prev => !prev)}
        onNavigate={handleNavigate}
        onLikeChange={bumpLibrary}
        onOpenArtist={openArtist}
        onOpenAlbum={openAlbum}
      />
      <Toaster />
    </div>
  );
}

function App() {
  return (
    <PlayerProvider>
      <DownloadsProvider>
        <AppContent />
      </DownloadsProvider>
    </PlayerProvider>
  );
}

export default App;
