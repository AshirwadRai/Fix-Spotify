// Graphic equalizer: band layout + presets.
//
// Eight peaking filters spanning sub-bass to air. Ten bands is the classic
// layout, but eight is what fits a phone screen as draggable sliders without
// each one becoming a 20px target — and the extra two buy almost nothing at
// these Q values.
//
// Gains are dB, clamped to ±12. Beyond that a boost just clips: the signal is
// already at full scale, so lifting a band 15dB drives it past 0dBFS and the
// result is distortion, not loudness.

export const EQ_BANDS = [60, 150, 400, 1000, 2400, 6000, 12000, 16000];
export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;

export const FLAT = [0, 0, 0, 0, 0, 0, 0, 0];

/**
 * Presets, in the order they're shown.
 *
 * `custom` has no curve of its own — it holds whatever the user last dragged,
 * which is why it lives in settings (eqGains) rather than here.
 */
export const EQ_PRESETS = [
  { id: 'flat', label: 'Flat', gains: FLAT },
  { id: 'rock', label: 'Rock', gains: [5, 3, -1, -2, 1, 3, 4, 4] },
  { id: 'metal', label: 'Metal', gains: [6, 4, -2, -3, 2, 5, 5, 3] },
  { id: 'pop', label: 'Pop', gains: [-1, 2, 4, 4, 2, -1, -1, -2] },
  { id: 'hiphop', label: 'Hip-Hop', gains: [7, 5, 1, -1, -1, 1, 2, 3] },
  { id: 'electronic', label: 'Electronic', gains: [6, 4, 0, -2, 1, 2, 5, 6] },
  { id: 'classical', label: 'Classical', gains: [4, 3, -1, -2, -1, 2, 3, 4] },
  { id: 'jazz', label: 'Jazz', gains: [3, 2, 1, 2, -1, -1, 2, 3] },
  { id: 'vocal', label: 'Vocal', gains: [-3, -2, 2, 5, 5, 3, 0, -2] },
  { id: 'bass', label: 'Bass Boost', gains: [9, 7, 4, 1, 0, 0, 0, 0] },
  { id: 'treble', label: 'Treble Boost', gains: [0, 0, 0, 0, 2, 5, 7, 8] },
  { id: 'custom', label: 'Custom', gains: null },
];

export function presetGains(id) {
  const p = EQ_PRESETS.find((x) => x.id === id);
  return p && p.gains ? p.gains : null;
}

/** Always returns a usable 8-band array — a stored value can be short or junk. */
export function normalizeGains(gains) {
  const out = EQ_BANDS.map((_, i) => {
    const v = Number(gains?.[i]);
    if (!Number.isFinite(v)) return 0;
    return Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, v));
  });
  return out;
}

/** The curve actually applied: a preset's own gains, or the user's custom ones. */
export function resolveGains(settings) {
  if (!settings?.eqEnabled) return FLAT;
  const preset = presetGains(settings.eqPreset);
  return normalizeGains(preset || settings.eqGains);
}

export function isFlat(gains) {
  return (gains || []).every((g) => Math.abs(g) < 0.01);
}

/** Nicely short axis label: 60, 400, 1k, 16k. */
export function bandLabel(hz) {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}
