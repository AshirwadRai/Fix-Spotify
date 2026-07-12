// Shared app-settings store backed by localStorage with live propagation.
// Any component can read settings reactively via useAppSettings(), and any
// write via writeAppSettings()/writeAppSetting() notifies all listeners
// immediately (same-tab) through a custom event.

import { useState, useEffect } from 'react';

export const DEFAULT_SETTINGS = {
  audioQuality: 0,        // 0 = auto, else target kbps (96/128/256/320)
  crossfadeDuration: 0,   // seconds
  normalizeVolume: false,
  showSourceBadge: false,   // off by default — don't reveal the source unless asked
  showQualityBadge: false,  // off by default — show the streaming bitrate on the player
  autoplay: true,         // play similar songs when the queue runs out (radio)
};

const EVENT = 'appsettingschange';

export function readAppSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('appSettings') || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeAppSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  localStorage.setItem('appSettings', JSON.stringify(merged));
  window.dispatchEvent(new Event(EVENT));
  return merged;
}

export function writeAppSetting(key, value) {
  const next = { ...readAppSettings(), [key]: value };
  return writeAppSettings(next);
}

/**
 * Map the audioQuality setting to a concrete target bitrate (kbps).
 * 0 (auto) → 320 so we always fetch the best the source offers.
 */
export function qualityToBitrate(audioQuality) {
  const q = Number(audioQuality) || 0;
  return q > 0 ? q : 320;
}

/** React hook: returns the current settings, re-rendering on any change. */
export function useAppSettings() {
  const [settings, setSettings] = useState(readAppSettings);
  useEffect(() => {
    const handler = () => setSettings(readAppSettings());
    window.addEventListener(EVENT, handler);
    window.addEventListener('storage', handler); // cross-tab
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  return settings;
}
