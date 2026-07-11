import { useState, useEffect } from 'react';
import { Home, Search, Library, Plus, Heart, X, Trash2, Settings, Download, Disc3, ListMusic } from 'lucide-react';
import { readStoredTracks, readPlaylists, writePlaylists, cleanText } from '../utils/tracks';
import { useSavedCollections, removeSaved, collectionId } from '../utils/collections';
import { PlaylistCover } from './PlaylistCover';

export function Sidebar({ activeView, onNavigate, likedVersion, onOpenAlbum, onOpenPlaylist }) {
  const [playlists, setPlaylists] = useState([]);
  const [likedCount, setLikedCount] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  // Spotify-style library filter chips: null = all, 'playlists' | 'albums'
  const [libFilter, setLibFilter] = useState(null);
  const savedCollections = useSavedCollections();

  const showPlaylists = !libFilter || libFilter === 'playlists';
  const showAlbums = !libFilter || libFilter === 'albums';
  const visibleCollections = savedCollections.filter(c =>
    c.type === 'jsplaylist' ? showPlaylists : showAlbums
  );

  // Load playlists and liked count — refresh when view or likedVersion changes
  useEffect(() => {
    setPlaylists(readPlaylists());
    const liked = readStoredTracks('likedSongs');
    setLikedCount(liked.length);
  }, [activeView, likedVersion]);

  const createPlaylist = () => {
    const name = newPlaylistName.trim() || `My Playlist #${playlists.length + 1}`;
    const newPlaylist = {
      id: Date.now().toString(),
      name,
      tracks: [],
      createdAt: new Date().toISOString(),
    };
    const updated = [...playlists, newPlaylist];
    setPlaylists(updated);
    writePlaylists(updated);
    setShowCreateModal(false);
    setNewPlaylistName('');
  };

  const deletePlaylist = (e, id) => {
    e.stopPropagation();
    const updated = playlists.filter(p => p.id !== id);
    setPlaylists(updated);
    writePlaylists(updated);
  };

  const navItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'downloads', label: 'Downloads', icon: Download },
  ];

  return (
    <div className="w-[280px] flex flex-col h-full gap-2 p-2 shrink-0">
      {/* Top navigation card */}
      <div className="bg-spotify-base rounded-lg px-4 py-3">
        <nav className="space-y-1">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`flex items-center gap-5 w-full py-2 px-3 rounded-md transition-colors text-left
                  ${isActive 
                    ? 'text-white' 
                    : 'text-spotify-text-subdued hover:text-white'
                  }`}
              >
                <Icon className="w-6 h-6 shrink-0" strokeWidth={isActive ? 2.5 : 2} />
                <span className={`font-semibold text-sm ${isActive ? 'font-bold' : ''}`}>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Library card */}
      <div className="bg-spotify-base rounded-lg flex-1 flex flex-col overflow-hidden">
        {/* Library header */}
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => onNavigate('library')}
            className={`flex items-center gap-3 transition-colors
              ${activeView === 'library' || activeView === 'liked' ? 'text-white' : 'text-spotify-text-subdued hover:text-white'}`}
          >
            <Library className="w-6 h-6" />
            <span className="font-semibold text-sm">Your Library</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="text-spotify-text-subdued hover:text-white hover:bg-spotify-elevated-base rounded-full p-1.5 transition-all"
            title="Create playlist"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Filter chips — Spotify parity */}
        <div className="flex items-center gap-2 px-4 pb-2">
          {[
            { key: 'playlists', label: 'Playlists' },
            { key: 'albums', label: 'Albums' },
          ].map(({ key, label }) => {
            const active = libFilter === key;
            return (
              <button
                key={key}
                onClick={() => setLibFilter(active ? null : key)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  active
                    ? 'bg-white text-black'
                    : 'bg-spotify-background-tinted-base text-white hover:bg-spotify-background-tinted-highlight'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Library content */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {/* Liked Songs */}
          {showPlaylists && (
          <button
            onClick={() => onNavigate('liked')}
            className={`flex items-center gap-3 w-full p-2.5 rounded-md transition-colors text-left group
              ${activeView === 'liked' 
                ? 'bg-spotify-elevated-highlight' 
                : 'hover:bg-spotify-elevated-base'}`}
          >
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-600 to-blue-300 flex items-center justify-center rounded-md shrink-0 shadow-md">
              <Heart className="w-5 h-5 text-white" fill="white" />
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium text-white truncate">
                Liked Songs
              </span>
              <span className="text-xs text-spotify-text-subdued truncate">
                Playlist · {likedCount} songs
              </span>
            </div>
          </button>
          )}

          {/* User Playlists */}
          {showPlaylists && playlists.map(playlist => {
            const isActive = activeView === `playlist:${playlist.id}`;
            return (
              <div
                key={playlist.id}
                onClick={() => onNavigate(`playlist:${playlist.id}`)}
                className={`flex items-center gap-3 w-full p-2.5 rounded-md transition-colors cursor-pointer group
                  ${isActive ? 'bg-spotify-elevated-highlight' : 'hover:bg-spotify-elevated-base'}`}
              >
                <div className="w-12 h-12 shrink-0 rounded-md overflow-hidden">
                  <PlaylistCover tracks={playlist.tracks || []} size={48} />
                </div>
                <div className="flex-1 flex flex-col overflow-hidden">
                  <span className={`text-sm font-medium truncate ${isActive ? 'text-spotify-essential-bright-accent' : 'text-white'}`}>
                    {playlist.name}
                  </span>
                  <span className="text-xs text-spotify-text-subdued truncate">
                    Playlist · {playlist.tracks?.length || 0} songs
                  </span>
                </div>
                <button
                  onClick={(e) => deletePlaylist(e, playlist.id)}
                  className="opacity-0 group-hover:opacity-100 text-spotify-text-subdued hover:text-white p-1 transition-opacity"
                  title="Delete playlist"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}

          {/* Saved albums & JioSaavn playlists (respects the filter chips) */}
          {visibleCollections.map(c => {
            const isJs = c.type === 'jsplaylist';
            const open = () => isJs ? onOpenPlaylist?.(c.name, c.url) : onOpenAlbum?.(c.name, c.artist, c.songUrl, c.albumId);
            const isActive = activeView === `${isJs ? 'jsplaylist' : 'album'}:${c.name}`;
            return (
              <div
                key={`sc:${collectionId(c)}`}
                onClick={open}
                className={`flex items-center gap-3 w-full p-2.5 rounded-md transition-colors cursor-pointer group
                  ${isActive ? 'bg-spotify-elevated-highlight' : 'hover:bg-spotify-elevated-base'}`}
              >
                <div className="w-12 h-12 shrink-0 rounded-md overflow-hidden bg-spotify-elevated-highlight flex items-center justify-center">
                  {c.image ? <img src={c.image} className="w-full h-full object-cover" alt="" />
                    : (isJs ? <ListMusic className="w-5 h-5 text-spotify-text-subdued" /> : <Disc3 className="w-5 h-5 text-spotify-text-subdued" />)}
                </div>
                <div className="flex-1 flex flex-col overflow-hidden">
                  <span className={`text-sm font-medium truncate ${isActive ? 'text-spotify-essential-bright-accent' : 'text-white'}`}>{cleanText(c.name)}</span>
                  <span className="text-xs text-spotify-text-subdued truncate">
                    {isJs ? 'Playlist' : 'Album'}{c.artist ? ` · ${cleanText(c.artist)}` : ''}
                  </span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeSaved(c); }}
                  className="opacity-0 group-hover:opacity-100 text-spotify-text-subdued hover:text-white p-1 transition-opacity"
                  title="Remove from library"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Settings button — bottom of sidebar */}
      <button
        onClick={() => onNavigate('settings')}
        className={`flex items-center gap-3 px-4 py-3 bg-spotify-base rounded-lg transition-colors ${
          activeView === 'settings' ? 'text-white' : 'text-spotify-text-subdued hover:text-white'
        }`}
      >
        <Settings className="w-5 h-5" />
        <span className="text-sm font-medium">Settings</span>
      </button>

      {/* Create Playlist Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]" onClick={() => setShowCreateModal(false)}>
          <div className="bg-spotify-elevated-base rounded-xl p-6 w-80 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Create Playlist</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-spotify-text-subdued hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              value={newPlaylistName}
              onChange={e => setNewPlaylistName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createPlaylist()}
              placeholder="Playlist name"
              className="w-full bg-spotify-highlight border border-spotify-elevated-highlight rounded-md px-4 py-2.5 text-sm text-white placeholder-spotify-text-subdued focus:outline-none focus:ring-2 focus:ring-white/20 mb-4"
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm font-semibold text-white hover:scale-105 transition-transform"
              >
                Cancel
              </button>
              <button
                onClick={createPlaylist}
                className="px-6 py-2 bg-white text-black text-sm font-bold rounded-full hover:scale-105 transition-transform"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
