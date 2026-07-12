import { useAppSettings, qualityToBitrate } from '../../utils/settings';
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

/**
 * The streaming-quality pill (e.g. "320 kbps"), mirroring the desktop's quality
 * indicator. Off by default; enable under Settings → "Show Quality Badge". Shows
 * the track's real bitrate when the source reports one, otherwise the configured
 * quality ceiling.
 */
export function QualityBadge({ track, className = '' }) {
  const { showQualityBadge, audioQuality } = useAppSettings();
  if (!showQualityBadge) return null;

  const source = track?.playable_source || track?.primary_source || getPlayableSource(track);
  const reported = Number(track?.sources?.[source]?.bitrate) || 0;
  const kbps = reported > 0 ? reported : qualityToBitrate(audioQuality);
  if (!kbps) return null;

  return (
    <span
      className={`inline-flex items-center rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white/80 ${className}`}
    >
      {kbps} kbps
    </span>
  );
}
