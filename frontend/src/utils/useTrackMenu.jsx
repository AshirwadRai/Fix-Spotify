import { useState, useCallback, useRef } from 'react';
import { Heart, Plus, Music, ListPlus, ListStart, Download, Check } from 'lucide-react';
import { ContextMenu } from '../components/ContextMenu';
import { usePlayer } from '../store/PlayerContext';
import { useDownloads } from '../store/DownloadsContext';
import { isDownloaded } from './downloads';
import { isLiked as isLikedStore, toggleLiked } from './likes';
import {
  cleanText, normalizeTrack, readPlaylists, writePlaylists, goToMenuItems,
} from './tracks';

/**
 * useTrackMenu — the single source of truth for a track's right-click / 3-dot
 * context menu, shared by every view (search, playlist, liked, album, artist,
 * now-playing queue). Previously each view hand-rolled its own near-identical
 * menu; this collapses them into one consistent menu so "every song has the
 * same menu as the search items".
 *
 * Usage:
 *   const { openMenu, menuElement } = useTrackMenu({ onLibraryChange, onOpenArtist, onOpenAlbum });
 *   ...
 *   <div onContextMenu={(e) => openMenu(e, track)} ... />
 *   <button onClick={(e) => openMenu(e, track)}>⋯</button>
 *   {menuElement}
 *
 * Per-call `extraItems` lets a view append context-specific entries (e.g.
 * "Remove from this playlist") without forking the shared menu.
 */
export function useTrackMenu({ onLibraryChange, onOpenArtist, onOpenAlbum } = {}) {
  const { addNext, addToQueue } = usePlayer();
  const { startDownload } = useDownloads();
  const [menu, setMenu] = useState(null); // { track, x, y, extraItems }
  // The row element whose menu is open — highlighted (Spotify shows which row a
  // menu belongs to). Anchored to the nearest `.group` row so it survives even
  // when the 3-dot button (not the row) is the event target, and works across
  // every view without per-view changes.
  const activeElRef = useRef(null);

  const matches = (a, b) =>
    cleanText(a.title) === cleanText(b.title) && cleanText(a.artist) === cleanText(b.artist);

  const toggleLike = useCallback((track) => {
    toggleLiked(track);
    onLibraryChange?.();
  }, [onLibraryChange]);

  const addToPlaylist = useCallback((playlistId, track) => {
    const updated = readPlaylists().map(p => {
      if (p.id === playlistId && !(p.tracks || []).some(t => matches(t, track))) {
        return { ...p, tracks: [...(p.tracks || []), normalizeTrack(track)] };
      }
      return p;
    });
    writePlaylists(updated);
    onLibraryChange?.();
  }, [onLibraryChange]);

  const openMenu = useCallback((e, track, extraItems = []) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeElRef.current) activeElRef.current.classList.remove('ctx-menu-active');
    const row = e.currentTarget?.closest?.('.group') || e.currentTarget;
    activeElRef.current = (row && row.classList) ? row : null;
    if (activeElRef.current) activeElRef.current.classList.add('ctx-menu-active');
    setMenu({ track, x: e.clientX, y: e.clientY, extraItems });
  }, []);

  const closeMenu = useCallback(() => {
    if (activeElRef.current) {
      activeElRef.current.classList.remove('ctx-menu-active');
      activeElRef.current = null;
    }
    setMenu(null);
  }, []);

  const buildItems = (track, extraItems) => {
    const liked = isLikedStore(track);
    const downloaded = isDownloaded(track);
    const playlists = readPlaylists();
    const playlistSubmenu = playlists.length > 0
      ? playlists.map(pl => ({ label: pl.name, icon: Music, onClick: () => addToPlaylist(pl.id, track) }))
      : [{ label: 'No playlists yet', icon: Music, onClick: () => {} }];

    return [
      { label: 'Play next', icon: ListStart, onClick: () => addNext(track) },
      { label: 'Add to queue', icon: ListPlus, onClick: () => addToQueue(track) },
      { label: 'Add to playlist', icon: Plus, submenu: playlistSubmenu },
      { divider: true },
      {
        label: downloaded ? 'Downloaded' : 'Download',
        icon: downloaded ? Check : Download,
        onClick: () => { if (!downloaded) startDownload(track); },
      },
      {
        label: liked ? 'Remove from Liked Songs' : 'Save to Liked Songs',
        icon: Heart,
        onClick: () => toggleLike(track),
      },
      ...goToMenuItems(track, { onOpenArtist, onOpenAlbum }),
      ...extraItems,
    ];
  };

  const menuElement = menu ? (
    <ContextMenu
      items={buildItems(menu.track, menu.extraItems)}
      position={{ x: menu.x, y: menu.y }}
      onClose={closeMenu}
    />
  ) : null;

  return { openMenu, closeMenu, menuElement, toggleLike };
}
