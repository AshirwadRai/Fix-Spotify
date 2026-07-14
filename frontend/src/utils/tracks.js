import { toast } from './toast.js';
import { User, Disc3 } from 'lucide-react';

const PLAYABLE_SOURCES = new Set(['jiosaavn', 'soundcloud', 'youtube', 'youtube_music']);

const TEXT_REPLACEMENTS = [
  [/&quot;/gi, '"'],
  [/&#34;/g, '"'],
  [/&#39;/g, "'"],
  [/&amp;/gi, '&'],
  [/&apos;/gi, "'"],
  [/\u00c2\u00b7/g, '\u00b7'],
  [/\u00e2\u20ac\u2122/g, "'"],
  [/\u00e2\u20ac\u0153|\u00e2\u20ac\ufffd/g, '"'],
  [/\u00e2\u20ac\u201c|\u00e2\u20ac\u201d/g, '-'],
];

const ARTWORK_PRIORITY = [
  '1200',
  '1000',
  '600',
  '500',
  'xl',
  '300',
  'large',
  'source:jiosaavn',
  'source:youtube',
  'source:soundcloud',
  'enriched',
  '100',
  'medium',
  'small',
  'source:itunes',
];

export function cleanText(value) {
  if (value == null) return '';
  let text = String(value);
  TEXT_REPLACEMENTS.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });

  // Title cleanup: Remove text in parentheses or brackets containing noise keywords
  text = text.replace(/\s*[([{].*?(?:official|video|audio|lyric|remaster|live|feat\.|ft\.|full\s+video|hd|4k|visuali[sz]er|music\s+video|song\s+video|original\s+motion|bollywood).*?[)\]}/]/gi, '');

  // Remove pipe-separated suffixes: "Song Name | Official Music Video"
  text = text.replace(/\s*\|.*(?:official|video|audio|lyric|full|hd|4k|visuali[sz]er)/gi, '');

  // Remove dash-separated suffixes only when they contain noise words:
  // "Song Name - Official Music Video" but NOT "Artist Name - Song Name"
  text = text.replace(/\s+-\s+(?:official|full)\s+.*$/gi, '');

  // Remove standalone "feat." or "ft." at the end
  text = text.replace(/\s+(?:feat\.|ft\.).*$/gi, '');

  const parser = typeof document !== 'undefined' ? document.createElement('textarea') : null;
  if (parser) {
    parser.innerHTML = text;
    text = parser.value;
  }

  return text.replace(/\s+/g, ' ').trim();
}

export function getTrackId(track) {
  return [
    cleanText(track?.title).toLowerCase(),
    cleanText(track?.artist).toLowerCase(),
    track?.isrc || '',
  ].join('|');
}

/** The unique stream URL of a track's chosen playable source, or ''. */
export function trackStreamUrl(track) {
  const src = getPlayableSource(track);
  return (src && track?.sources?.[src]?.url) || '';
}

/**
 * The track's JioSaavn song-page URL, or '' if it isn't a JioSaavn /song/ link.
 * Used to open the song's EXACT album (variant releases share a name, so the
 * album string alone — e.g. "Memory Reboot (Slowed)" — resolves wrong).
 */
export function jiosaavnSongUrl(track) {
  const u = track?.sources?.jiosaavn?.url || '';
  return u.includes('/song/') ? u : '';
}

/**
 * True when two track objects refer to the SAME recording. Compares by the
 * playable source URL (unique per recording) when both have one; otherwise
 * falls back to title+artist+duration. This is why a 30s "preview" never
 * highlights as the currently-playing full track of the same name: they have
 * different source URLs (and different durations).
 */
export function sameTrack(a, b) {
  if (!a || !b) return false;
  const ua = trackStreamUrl(a);
  const ub = trackStreamUrl(b);
  if (ua && ub) return ua === ub;
  const norm = (s) => cleanText(s).toLowerCase();
  return (
    norm(a.title) === norm(b.title) &&
    norm(a.artist) === norm(b.artist) &&
    (a.duration_ms || 0) === (b.duration_ms || 0)
  );
}

/**
 * Ordered list of a track's playable sources [{source, url}] — quality-first
 * (JioSaavn 320k → SoundCloud → YouTube). The player tries them in order and
 * falls back to the next when one fails to stream (dead/DRM/geo-blocked), so a
 * song that exists on YouTube still plays even if its SoundCloud copy is dead.
 */
export function getPlayableSources(track) {
  const srcs = track?.sources || {};
  const ORDER = ['jiosaavn', 'soundcloud', 'youtube_music', 'youtube'];
  const out = [];
  for (const s of ORDER) {
    if (PLAYABLE_SOURCES.has(s) && srcs[s]?.url) out.push({ source: s, url: srcs[s].url });
  }
  for (const [s, d] of Object.entries(srcs)) {
    if (PLAYABLE_SOURCES.has(s) && d?.url && !out.some(o => o.source === s)) {
      out.push({ source: s, url: d.url });
    }
  }
  return out;
}

export function getPlayableSource(track) {
  if (!track?.sources) return null;

  const preferred = track.playable_source || track.primary_source;
  if (preferred && PLAYABLE_SOURCES.has(preferred) && track.sources[preferred]?.url) {
    return preferred;
  }

  return Object.entries(track.sources).find(([source, data]) => {
    return PLAYABLE_SOURCES.has(source) && Boolean(data?.url);
  })?.[0] || null;
}

/**
 * Copy a shareable reference for a track to the clipboard.
 * Prefers the real source URL (JioSaavn/YouTube/SoundCloud page) which is
 * publicly shareable; falls back to "Title - Artist". Shows a toast.
 */
export async function shareTrack(track) {
  const source = getPlayableSource(track);
  const url = track?.sources?.[source]?.url;
  const text = url || `${cleanText(track?.title)} - ${cleanText(track?.artist)}`;
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copied to clipboard');
    return true;
  } catch {
    toast('Could not copy link');
    return false;
  }
}

export function isPlayableTrack(track) {
  return Boolean(getPlayableSource(track));
}

export function getBestArtworkUrl(track) {
  const artworkUrls = track?.artwork_urls || track?.artworkUrls || {};
  let bestUrl = '';
  for (const size of ARTWORK_PRIORITY) {
    const url = artworkUrls[size];
    if (typeof url === 'string' && url) {
      bestUrl = url;
      break;
    }
  }

  if (!bestUrl) {
    const direct = track?.artwork_url;
    if (typeof direct === 'string' && direct) bestUrl = direct;
  }

  if (!bestUrl) {
    for (const url of Object.values(artworkUrls)) {
      if (typeof url === 'string' && url) {
        bestUrl = url;
        break;
      }
    }
  }

  if (bestUrl) {
    // Enhance JioSaavn low-res covers: replace any NxN (where N < 500) with 500x500
    bestUrl = bestUrl.replace(/(\d+)x(\d+)/g, (match, w, h) => {
      const width = parseInt(w, 10);
      const height = parseInt(h, 10);
      if (width < 500 || height < 500) return '500x500';
      return match;
    });

    // Enhance iTunes low-res: replace 100x100bb with 600x600bb
    bestUrl = bestUrl.replace(/(\d+)x(\d+)bb/g, (match, w) => {
      const width = parseInt(w, 10);
      if (width < 600) return '600x600bb';
      return match;
    });
  }
  return bestUrl;
}

export function normalizeTrack(track) {
  if (!track) return null;
  const playableSource = getPlayableSource(track);
  const bestArt = getBestArtworkUrl(track);

  // Ensure artwork_urls dict exists and has the best URL baked in
  // so it persists through localStorage round-trips
  const artworkUrls = { ...(track.artwork_urls || track.artworkUrls || {}) };
  if (bestArt && !Object.values(artworkUrls).includes(bestArt)) {
    artworkUrls['enriched'] = bestArt;
  }

  const normalized = {
    ...track,
    title: cleanText(track.title),
    artist: cleanText(track.artist),
    album: cleanText(track.album),
    artwork_url: bestArt,
    artwork_urls: artworkUrls,
    primary_source: playableSource || track.primary_source || null,
    playable_source: playableSource,
    is_playable: Boolean(playableSource),
  };

  return normalized;
}

/**
 * Enrich a track's artwork via the iTunes lookup API.
 * Mutates the track in-place and returns the artwork URL.
 */
export async function enrichTrackArtwork(track, apiFn) {
  if (!track || getBestArtworkUrl(track)) return getBestArtworkUrl(track);
  try {
    const url = await apiFn(cleanText(track.title), cleanText(track.artist));
    if (url) {
      if (!track.artwork_urls) track.artwork_urls = {};
      track.artwork_urls['enriched'] = url;
      track.artwork_url = url;
    }
    return url || '';
  } catch {
    return '';
  }
}

/**
 * Apply a metadata-enrichment payload (from /api/enrich) onto a track.
 * Overlays clean artist/album/artwork/release-date/genre while keeping the
 * playable source intact. Returns a NEW track object (does not mutate input).
 */
export function applyEnrichment(track, enrichment) {
  if (!track || !enrichment) return track;

  const artworkUrls = { ...(track.artwork_urls || track.artworkUrls || {}) };
  // Overlay hi-res artwork sizes (600/300/100 from iTunes, etc.)
  const art = enrichment.artwork || {};
  for (const [size, url] of Object.entries(art)) {
    if (typeof url === 'string' && url) artworkUrls[size] = url;
  }

  // JioSaavn has clean, correct metadata for its own (esp. Indian) catalog;
  // iTunes "enrichment" tends to MANGLE it — appending "(Original Motion Picture
  // Soundtrack)"/"- Single", rewriting "A, B" → "A & B", or mismatching outright.
  // So for a track that came from JioSaavn, KEEP JioSaavn's artist/album and only
  // fill a genuinely-empty field. Non-JioSaavn sources (SoundCloud/YouTube channel
  // junk like "Maymon Abdullah") still get iTunes' cleaner artist/album. Artwork,
  // genre, release_date and isrc always overlay/gap-fill (pure gains either way).
  const fromJioSaavn = !!track.sources?.jiosaavn?.url;
  const enrArtist = enrichment.artist ? cleanText(enrichment.artist) : '';
  const enrAlbum = enrichment.album ? cleanText(enrichment.album) : '';

  const merged = {
    ...track,
    artist: fromJioSaavn ? (track.artist || enrArtist) : (enrArtist || track.artist),
    album: fromJioSaavn ? (track.album || enrAlbum) : (enrAlbum || track.album),
    artwork_urls: artworkUrls,
    isrc: track.isrc || enrichment.isrc || null,
    release_date: track.release_date || enrichment.release_date || null,
    genre: track.genre || enrichment.genre || null,
    duration_ms: track.duration_ms || enrichment.duration_ms || null,
    _enriched: true,
  };
  // Re-bake best artwork so getBestArtworkUrl/persistence pick up the new art
  merged.artwork_url = getBestArtworkUrl(merged);
  return merged;
}

export function normalizeTracks(tracks = []) {
  return tracks.map(normalizeTrack).filter(Boolean);
}

export function playableTracks(tracks = []) {
  return normalizeTracks(tracks).filter(isPlayableTrack);
}

export function uniqueTracks(tracks = []) {
  const seen = new Set();
  const unique = [];
  for (const track of tracks) {
    const id = getTrackId(track);
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(track);
    }
  }
  return unique;
}

export function readStoredTracks(key) {
  try {
    return playableTracks(JSON.parse(localStorage.getItem(key) || '[]'));
  } catch {
    return [];
  }
}

/** Safely read the user's playlists array — never throws, always returns an array. */
export function readPlaylists() {
  try {
    const data = JSON.parse(localStorage.getItem('playlists') || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Safely persist the playlists array — never throws. */
export function writePlaylists(playlists) {
  try {
    localStorage.setItem('playlists', JSON.stringify(Array.isArray(playlists) ? playlists : []));
  } catch { /* storage full / unavailable — ignore */ }
  return Array.isArray(playlists) ? playlists : [];
}

export function writeStoredTracks(key, tracks, limit) {
  const cleaned = uniqueTracks(playableTracks(tracks));
  const limited = typeof limit === 'number' ? cleaned.slice(0, limit) : cleaned;
  localStorage.setItem(key, JSON.stringify(limited));
  return limited;
}

/**
 * Split a track's artist credit string into individual artist names.
 *
 * Splits on commas / slashes / semicolons / ampersands / "feat."/"ft." / " x ".
 * Genuine hyphenated duos stay intact ("Vishal-Shekhar", "Sachin-Jigar",
 * "Bharatt-Saurabh") because we never split on "-". De-duplicates
 * case-insensitively and drops empties.
 *
 * Note: "&" is treated as a separator (e.g. "Hans Zimmer & James Newton Howard"
 * → two artists), which is correct far more often than not. The rare joint act
 * written with "&" (e.g. "Earth, Wind & Fire") is an accepted trade-off.
 */
export function splitArtists(artist) {
  const cleaned = cleanText(artist);
  if (!cleaned) return [];
  const parts = cleaned.split(/\s*,\s*|\s*;\s*|\s*\/\s*|\s+&\s+|\s+feat\.?\s+|\s+ft\.?\s+|\s+x\s+/i);
  const seen = new Set();
  const out = [];
  for (let p of parts) {
    p = p.trim();
    if (p.length < 2) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.length ? out : [cleaned];
}

/**
 * Build the shared "Go to artist" / "Go to album" context-menu items for a
 * track. When a track credits multiple artists, "Go to artist" becomes a
 * submenu listing each one separately (Spotify-style), and clicking a name
 * opens that artist's profile.
 *
 * Pass the navigation callbacks the host view has; omit one to hide its item
 * (e.g. AlbumView passes no onOpenAlbum since you're already on the album).
 */
export function goToMenuItems(track, { onOpenArtist, onOpenAlbum } = {}) {
  const items = [];

  if (onOpenArtist) {
    const artists = splitArtists(track?.artist);
    if (artists.length > 1) {
      items.push({
        label: 'Go to artist',
        icon: User,
        submenu: artists.map(a => ({ label: a, icon: User, onClick: () => onOpenArtist(a) })),
      });
    } else if (artists.length === 1) {
      items.push({ label: 'Go to artist', icon: User, onClick: () => onOpenArtist(artists[0]) });
    }
  }

  if (onOpenAlbum) {
    const album = cleanText(track?.album);
    if (album && album.toLowerCase() !== 'unknown album') {
      const primaryArtist = splitArtists(track?.artist)[0] || '';
      items.push({ label: 'Go to album', icon: Disc3, onClick: () => onOpenAlbum(album, primaryArtist, jiosaavnSongUrl(track)) });
    }
  }

  return items;
}


/**
 * Spotify-style total runtime for a track list, e.g. "about 53 min" or
 * "3 hr 12 min". Returns '' when no track carries a duration.
 * ponytail: sums catalog `duration_ms`; tracks missing it are skipped, so this
 * is a floor estimate (hence "about"). Upgrade path = fill duration on enrich.
 */
export function formatTotalDuration(tracks = []) {
  const ms = (tracks || []).reduce((sum, t) => sum + (t?.duration_ms || 0), 0);
  if (ms <= 0) return '';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `about ${totalMin} min`;
  const hr = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min ? `${hr} hr ${min} min` : `${hr} hr`;
}
