import { useState, useEffect } from 'react';
import { Play, User, Disc3, BadgeCheck } from 'lucide-react';
import { usePlayer } from '../store/PlayerContext';
import { cleanText, normalizeTracks, sameTrack } from '../utils/tracks';
import { clickProps } from '../utils/clickable';
import { useLikedSongs, toggleLiked } from '../utils/likes';
import { useTrackMenu } from '../utils/useTrackMenu';
import { useRowSelection } from '../utils/useRowSelection';
import { useRovingTabIndex } from '../utils/useRovingTabIndex';
import { useDominantColor } from '../utils/useDominantColor';
import { TrackRow } from './TrackRow';
import { ArtistSkeleton } from './Skeleton';
import { api } from '../api';

const formatCount = (n) => {
  if (!n) return null;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
};

export function ArtistView({ name, onOpenArtist, onOpenAlbum, onLibraryChange }) {
  const [artist, setArtist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showFullBio, setShowFullBio] = useState(false);
  const [selIdx, setSelIdx] = useRowSelection(); // selected (clicked) row, Spotify-style
  const { playTrack, currentTrack, isPlaying, setQueue } = usePlayer();
  const likedSongs = useLikedSongs();
  const { openMenu, menuElement } = useTrackMenu({ onLibraryChange, onOpenArtist, onOpenAlbum });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setArtist(null);
    setShowFullBio(false);
    api.getArtist(name).then(data => {
      if (cancelled) return;
      if (data) setArtist({ ...data, top_songs: normalizeTracks(data.top_songs || []) });
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [name]);

  // Tint the hero from the artist's own photo (reuses fast-average-color). Hook
  // must run before any early return, so derive the source from artist state.
  const heroColor = useDominantColor(artist ? (artist.banner || artist.image) : null);
  const roving = useRovingTabIndex(Math.min(8, (artist?.top_songs || []).length), selIdx);

  const isLiked = (t) => likedSongs.some(x => cleanText(x.title) === cleanText(t.title) && cleanText(x.artist) === cleanText(t.artist));
  const toggleLike = (track) => { toggleLiked(track); onLibraryChange?.(); };

  if (loading) return <ArtistSkeleton />;

  if (!artist || !artist.name) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-spotify-text-subdued gap-2 text-center px-8">
        <User className="w-12 h-12" />
        <p className="text-lg font-bold text-white">Artist not available</p>
        <p className="text-sm">We couldn't load a profile for "{cleanText(name)}".</p>
      </div>
    );
  }

  const topSongs = artist.top_songs || [];
  const albums = artist.albums || [];
  const similar = artist.similar_artists || [];
  const listeners = formatCount(artist.listeners);
  const heroImage = artist.banner || artist.image;

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Hero header */}
      <div className="relative">
        <div className="h-72 w-full overflow-hidden bg-spotify-elevated-highlight">
          {heroImage ? (
            <img src={heroImage} className="w-full h-full object-cover" alt="" style={{ objectPosition: 'center 30%' }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center"><User className="w-20 h-20 text-spotify-text-subdued" /></div>
          )}
          <div className="absolute inset-0" style={{ background: `linear-gradient(transparent 25%, rgba(0,0,0,0.55) 70%, ${heroColor ? `rgb(${heroColor})` : 'var(--color-spotify-base)'})` }} />
        </div>
        <div className="absolute bottom-0 left-0 px-6 pb-5">
          {artist.verified && (
            <div className="flex items-center gap-1.5 mb-2 text-sm font-medium text-white">
              <BadgeCheck className="w-5 h-5 text-[#3d91f4]" fill="currentColor" /> Verified Artist
            </div>
          )}
          <h1 className="text-6xl font-extrabold text-white drop-shadow-lg">{cleanText(artist.name)}</h1>
          <div className="flex items-center gap-3 mt-3 text-sm text-white/90">
            {listeners && <span>{listeners} listeners</span>}
            {artist.genre && <span className="capitalize">· {artist.genre}</span>}
            {artist.founded && <span>· since {artist.founded}</span>}
          </div>
        </div>
      </div>

      {heroColor && (
        <div
          className="h-24 -mt-px pointer-events-none"
          style={{ background: `linear-gradient(rgb(${heroColor}) 0%, var(--color-spotify-base) 100%)` }}
        />
      )}

      {/* Nothing playable, but a real artist (e.g. an act we have no catalog
          for) — show the page with a gentle note instead of a dead end. */}
      {topSongs.length === 0 && albums.length === 0 && (
        <p className="px-6 py-8 text-sm text-spotify-text-subdued">
          We don't have any songs for this artist yet.
        </p>
      )}

      {/* Actions */}
      {topSongs.length > 0 && (
        <div className="flex items-center gap-5 px-6 py-5">
          <button
            onClick={() => { playTrack(topSongs[0]); setQueue(topSongs.slice(1)); }}
            className="w-14 h-14 rounded-full bg-spotify-essential-bright-accent flex items-center justify-center hover:scale-105 shadow-xl transition-transform"
          >
            <Play className="w-6 h-6 text-black ml-0.5" fill="currentColor" />
          </button>
        </div>
      )}

      {/* Popular */}
      {topSongs.length > 0 && (
        <section className="px-2 mb-8">
          <h2 className="text-xl font-bold text-white mb-3 px-4">Popular</h2>
          <div className="space-y-0.5" {...roving.listProps}>
            {topSongs.slice(0, 8).map((track, idx) => (
              <TrackRow
                key={idx}
                track={track}
                index={idx}
                isCurrent={sameTrack(currentTrack, track)}
                isPlaying={isPlaying}
                selected={selIdx === idx}
                onSelect={setSelIdx}
                tabIndex={roving.tabIndex(idx)}
                onPlay={() => { playTrack(track); setQueue(topSongs.slice(idx + 1)); }}
                onMenu={(e) => openMenu(e, track)}
                onOpenAlbum={onOpenAlbum}
                showArtist={false}
                liked={isLiked(track)}
                onToggleLike={toggleLike}
              />
            ))}
          </div>
        </section>
      )}

      {/* Discography */}
      {albums.length > 0 && (
        <section className="px-6 mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Discography</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {albums.map((al, idx) => (
              <div
                key={idx}
                {...clickProps(() => onOpenAlbum && onOpenAlbum(cleanText(al.name), cleanText(al.artist || artist.name)), `${cleanText(al.name)}, Album`)}
                className="bg-spotify-elevated-base/60 hover:bg-spotify-elevated-highlight rounded-md p-3 cursor-pointer transition-all group"
              >
                <div className="relative mb-3">
                  {al.image ? <img src={al.image} className="w-full aspect-square object-cover rounded-md shadow-lg" alt="" />
                    : <div className="w-full aspect-square bg-spotify-elevated-highlight rounded-md flex items-center justify-center"><Disc3 className="w-10 h-10 text-spotify-text-subdued" /></div>}
                  <button tabIndex={-1} className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-spotify-essential-bright-accent flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-2xl translate-y-2 group-hover:translate-y-0 transition-all">
                    <Play className="w-4 h-4 text-black ml-0.5" fill="currentColor" />
                  </button>
                </div>
                <p className="text-sm font-medium text-white truncate">{cleanText(al.name)}</p>
                <p className="text-xs text-spotify-text-subdued mt-0.5 truncate">{al.year ? `${al.year} · ` : ''}Album</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Fans also like */}
      {similar.length > 0 && (
        <section className="px-6 mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Fans also like</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {similar.map((s, idx) => (
              <div
                key={idx}
                {...clickProps(() => onOpenArtist && onOpenArtist(cleanText(s.name)), `${cleanText(s.name)}, Artist`)}
                className="bg-spotify-elevated-base/60 hover:bg-spotify-elevated-highlight rounded-md p-3 cursor-pointer transition-all group text-center"
              >
                <div className="relative mb-3">
                  {s.image ? <img src={s.image} className="w-full aspect-square object-cover rounded-full shadow-lg" alt="" />
                    : <div className="w-full aspect-square bg-spotify-elevated-highlight rounded-full flex items-center justify-center"><User className="w-10 h-10 text-spotify-text-subdued" /></div>}
                </div>
                <p className="text-sm font-medium text-white truncate">{cleanText(s.name)}</p>
                <p className="text-xs text-spotify-text-subdued mt-0.5">Artist</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* About */}
      {artist.bio && (
        <section className="px-6 mb-10">
          <h2 className="text-xl font-bold text-white mb-4">About</h2>
          <div className="max-w-3xl">
            <p className={`text-sm text-spotify-text-subdued leading-relaxed whitespace-pre-line ${showFullBio ? '' : 'line-clamp-5'}`}>
              {artist.bio}
            </p>
            {artist.bio.length > 300 && (
              <button onClick={() => setShowFullBio(v => !v)} className="mt-2 text-sm font-bold text-white hover:underline">
                {showFullBio ? 'Show less' : 'Read more'}
              </button>
            )}
            {(artist.country || (artist.tags || []).length > 0) && (
              <div className="flex flex-wrap gap-2 mt-4">
                {artist.country && <span className="px-3 py-1 rounded-full bg-spotify-elevated-base text-xs text-spotify-text-subdued">{artist.country}</span>}
                {(artist.tags || []).slice(0, 5).map((tag, i) => (
                  <span key={i} className="px-3 py-1 rounded-full bg-spotify-elevated-base text-xs text-spotify-text-subdued capitalize">{tag}</span>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {menuElement}
    </div>
  );
}
