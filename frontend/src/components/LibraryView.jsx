import { useState, useMemo, useEffect } from 'react';
import { Search, Heart, Disc3, ListMusic } from 'lucide-react';
import { usePlayer } from '../store/PlayerContext';
import { cleanText, readPlaylists, sameTrack } from '../utils/tracks';
import { clickProps } from '../utils/clickable';
import { useLikedSongs, toggleLiked, isLiked } from '../utils/likes';
import { useSavedCollections, collectionId } from '../utils/collections';
import { useTrackMenu } from '../utils/useTrackMenu';
import { useRowSelection } from '../utils/useRowSelection';
import { useRovingTabIndex } from '../utils/useRovingTabIndex';
import { TrackRow, TrackListHeader } from './TrackRow';
import { PlaylistCover } from './PlaylistCover';

// The user's library as a page: every saved thing in one place, with a Spotify-
// style search that matches BOTH collection names and song titles within them
// (Liked + your playlists + saved albums/playlists).
export function LibraryView({ libraryVersion, onNavigate, onOpenAlbum, onOpenPlaylist, onOpenArtist, onLikeChange }) {
  const [query, setQuery] = useState('');
  const likedSongs = useLikedSongs();
  const savedCollections = useSavedCollections();
  const [playlists, setPlaylists] = useState(readPlaylists);
  useEffect(() => { setPlaylists(readPlaylists()); }, [libraryVersion]);

  const { playTrack, currentTrack, isPlaying, setQueue } = usePlayer();
  const [selIdx, setSelIdx] = useRowSelection();
  const { openMenu, menuElement } = useTrackMenu({ onLibraryChange: onLikeChange, onOpenArtist, onOpenAlbum });

  const q = cleanText(query).toLowerCase().trim();

  const collections = useMemo(() => {
    const items = [{ key: 'liked', kind: 'liked', name: 'Liked Songs', count: likedSongs.length }];
    for (const p of playlists) items.push({ key: `pl:${p.id}`, kind: 'playlist', id: p.id, name: p.name, tracks: p.tracks || [], count: (p.tracks || []).length });
    for (const c of savedCollections) items.push({ key: `sc:${collectionId(c)}`, kind: c.type || 'album', ...c, count: (c.tracks || []).length });
    return items;
  }, [likedSongs.length, playlists, savedCollections]);

  const matchedCollections = q ? collections.filter(c => c.name.toLowerCase().includes(q)) : collections;

  // Songs across the whole library, de-duped by title+artist, capped.
  const songMatches = useMemo(() => {
    if (!q) return [];
    const out = [];
    const seen = new Set();
    const consider = (t) => {
      if (!t) return;
      const title = cleanText(t.title).toLowerCase();
      const artist = cleanText(t.artist).toLowerCase();
      if (!title.includes(q) && !artist.includes(q)) return;
      const id = `${title}|${artist}`;
      if (seen.has(id)) return;
      seen.add(id);
      out.push(t);
    };
    likedSongs.forEach(consider);
    playlists.forEach(p => (p.tracks || []).forEach(consider));
    savedCollections.forEach(c => (c.tracks || []).forEach(consider));
    return out.slice(0, 60);
  }, [q, likedSongs, playlists, savedCollections]);

  const openCollection = (c) => {
    if (c.kind === 'liked') return onNavigate('liked');
    if (c.kind === 'playlist') return onNavigate(`playlist:${c.id}`);
    if (c.kind === 'jsplaylist') return onOpenPlaylist?.(c.name, c.url);
    return onOpenAlbum?.(c.name, c.artist, c.songUrl, c.albumId);
  };

  const subtitle = (c) => {
    if (c.kind === 'liked') return `Playlist · ${c.count} songs`;
    if (c.kind === 'playlist') return `Playlist · ${c.count} songs`;
    if (c.kind === 'jsplaylist') return `Playlist${c.subtitle ? ` · ${cleanText(c.subtitle)}` : ''}`;
    return `Album${c.artist ? ` · ${cleanText(c.artist)}` : ''}`;
  };

  const cover = (c) => {
    if (c.kind === 'liked') {
      return (
        <div className="w-12 h-12 bg-gradient-to-br from-indigo-600 to-blue-300 flex items-center justify-center rounded-md shrink-0 shadow-md">
          <Heart className="w-5 h-5 text-white" fill="white" />
        </div>
      );
    }
    if (c.kind === 'playlist') {
      return <div className="w-12 h-12 shrink-0 rounded-md overflow-hidden"><PlaylistCover tracks={c.tracks || []} size={48} /></div>;
    }
    return (
      <div className="w-12 h-12 shrink-0 rounded-md overflow-hidden bg-spotify-elevated-highlight flex items-center justify-center">
        {c.image ? <img src={c.image} className="w-full h-full object-cover" alt="" />
          : (c.kind === 'jsplaylist' ? <ListMusic className="w-5 h-5 text-spotify-text-subdued" /> : <Disc3 className="w-5 h-5 text-spotify-text-subdued" />)}
      </div>
    );
  };

  const noResults = q && matchedCollections.length === 0 && songMatches.length === 0;
  const roving = useRovingTabIndex(songMatches.length, selIdx);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 pt-6 pb-4 flex flex-col gap-4">
        <h1 className="text-3xl font-extrabold text-white">Your Library</h1>
        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-spotify-text-subdued absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search in Your Library"
            className="w-full bg-spotify-highlight rounded-md pl-9 pr-3 py-2 text-sm text-white placeholder-spotify-text-subdued focus:outline-none focus:ring-2 focus:ring-white/20"
          />
        </div>
      </div>

      {noResults ? (
        <div className="px-6 py-12 text-center text-spotify-text-subdued">
          <p className="text-white font-semibold mb-1">Nothing in your library matches "{query}"</p>
          <p className="text-sm">Try a different song, album, or playlist name.</p>
        </div>
      ) : (
        <div className="px-4 pb-6">
          {/* Collections */}
          {matchedCollections.length > 0 && (
            <div className="mb-6">
              {q && <h2 className="px-2 text-xs font-bold uppercase tracking-wider text-spotify-text-subdued mb-2">Playlists & Albums</h2>}
              <div className="space-y-0.5">
                {matchedCollections.map(c => (
                  <div
                    key={c.key}
                    {...clickProps(() => openCollection(c), `${cleanText(c.name)}, ${subtitle(c)}`)}
                    className="flex items-center gap-3 w-full p-2 rounded-md hover:bg-spotify-elevated-base cursor-pointer"
                  >
                    {cover(c)}
                    <div className="flex flex-col overflow-hidden">
                      <span className="text-sm font-medium text-white truncate">{cleanText(c.name)}</span>
                      <span className="text-xs text-spotify-text-subdued truncate">{subtitle(c)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Songs (only while searching) */}
          {songMatches.length > 0 && (
            <div>
              <h2 className="px-2 text-xs font-bold uppercase tracking-wider text-spotify-text-subdued mb-2">Songs</h2>
              <TrackListHeader />
              <div className="space-y-0.5" {...roving.listProps}>
                {songMatches.map((track, idx) => (
                  <TrackRow
                    key={`${track.title}|${track.artist}|${idx}`}
                    track={track}
                    index={idx}
                    isCurrent={sameTrack(currentTrack, track)}
                    isPlaying={isPlaying}
                    selected={selIdx === idx}
                    onSelect={setSelIdx}
                    tabIndex={roving.tabIndex(idx)}
                    onPlay={() => { playTrack(track); setQueue(songMatches.filter((_, i) => i !== idx)); }}
                    onMenu={(e) => openMenu(e, track)}
                    onOpenArtist={onOpenArtist}
                    onOpenAlbum={onOpenAlbum}
                    liked={isLiked(track)}
                    onToggleLike={(t) => { toggleLiked(t); onLikeChange?.(); }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {menuElement}
    </div>
  );
}
