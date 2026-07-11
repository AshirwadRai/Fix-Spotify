import { useAppSettings } from '../../utils/settings';
import { getPlayableSource } from '../../utils/tracks';

// Human label + accent for each playable source.
const META = {
  jiosaavn: { label: 'JioSaavn', cls: 'bg-[#1db954]/15 text-[#1ed760]' },
  soundcloud: { label: 'SoundCloud', cls: 'bg-[#ff5500]/15 text-[#ff7733]' },
  youtube: { label: 'YouTube', cls: 'bg-[#ff0000]/15 text-[#ff4444]' },
  youtube_music: { label: 'YT Music', cls: 'bg-[#ff0000]/15 text-[#ff4444]' },
};

/**
 * The "where this track plays from" pill. Renders only when the user has
 * "Show Source Badge" enabled (Settings) — hence reading the setting here rather
 * than at each call site, so callers can drop it in unconditionally.
 */
export function SourceBadge({ track, className = '' }) {
  const { showSourceBadge } = useAppSettings();
  if (!showSourceBadge) return null;

  const source = track?.playable_source || track?.primary_source || getPlayableSource(track);
  const meta = META[source];
  if (!meta) return null;

  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none ${meta.cls} ${className}`}
    >
      {meta.label}
    </span>
  );
}
