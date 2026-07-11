import { Music } from 'lucide-react';
import { getBestArtworkUrl } from '../utils/tracks';

/**
 * Dynamic playlist cover art component.
 * - 0 tracks: music icon placeholder
 * - 1 track: full cover of that track
 * - 2 tracks: side by side (50/50 horizontal)
 * - 3 tracks: 2 top + 1 bottom (spanning full width)
 * - 4+ tracks: 2×2 grid of first 4 tracks
 */
export function PlaylistCover({ tracks = [], size = 48 }) {
  // Collect artwork URLs from tracks
  const artworks = tracks
    .map(t => getBestArtworkUrl(t))
    .filter(Boolean)
    .slice(0, 4);

  const s = size;

  // No artwork available
  if (artworks.length === 0) {
    return (
      <div
        className="bg-spotify-elevated-highlight flex items-center justify-center rounded-md"
        style={{ width: s, height: s }}
      >
        <Music className="text-spotify-text-subdued" style={{ width: s * 0.4, height: s * 0.4 }} />
      </div>
    );
  }

  // 1 track — full cover
  if (artworks.length === 1) {
    return (
      <img
        src={artworks[0]}
        alt=""
        className="object-cover rounded-md"
        style={{ width: s, height: s }}
      />
    );
  }

  // 2 tracks — side by side
  if (artworks.length === 2) {
    return (
      <div className="flex rounded-md overflow-hidden" style={{ width: s, height: s }}>
        <img src={artworks[0]} alt="" className="object-cover" style={{ width: s / 2, height: s }} />
        <img src={artworks[1]} alt="" className="object-cover" style={{ width: s / 2, height: s }} />
      </div>
    );
  }

  // 3 tracks — 2 top, 1 bottom spanning full width
  if (artworks.length === 3) {
    return (
      <div className="flex flex-col rounded-md overflow-hidden" style={{ width: s, height: s }}>
        <div className="flex" style={{ height: s / 2 }}>
          <img src={artworks[0]} alt="" className="object-cover" style={{ width: s / 2, height: s / 2 }} />
          <img src={artworks[1]} alt="" className="object-cover" style={{ width: s / 2, height: s / 2 }} />
        </div>
        <img src={artworks[2]} alt="" className="object-cover" style={{ width: s, height: s / 2 }} />
      </div>
    );
  }

  // 4+ tracks — 2×2 grid
  return (
    <div className="grid grid-cols-2 rounded-md overflow-hidden" style={{ width: s, height: s }}>
      {artworks.slice(0, 4).map((url, i) => (
        <img
          key={i}
          src={url}
          alt=""
          className="object-cover"
          style={{ width: s / 2, height: s / 2 }}
        />
      ))}
    </div>
  );
}
