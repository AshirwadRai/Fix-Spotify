import { useState, useEffect, useCallback } from 'react';
import { Check, RotateCcw, HardDrive, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
// Namespace import: each preset names its own glyph (see utils/eq.js), so the
// component resolves it by name rather than the file re-listing all twelve.
import * as LucideIcons from 'lucide-react';
import {
  useAppSettings, writeAppSetting, writeAppSettings, DEFAULT_SETTINGS,
} from '../../utils/settings';
import {
  EQ_BANDS, EQ_PRESETS, EQ_MIN_DB, EQ_MAX_DB,
  resolveGains, presetGains, normalizeGains, bandLabel,
} from '../../utils/eq';
import { api } from '../../api';
import { toast } from '../../utils/toast';
import {
  isAndroid, getAppVersion, checkForUpdate, installUpdate, registerUpdateHandlers,
  requestStorageAccess, pickDownloadFolder,
} from '../androidBridge';

const QUALITIES = [
  { value: 0, label: 'Auto', hint: 'Adjusts automatically based on source' },
  { value: 96, label: 'Low', hint: '96 kbps — saves mobile data' },
  { value: 128, label: 'Normal', hint: '128 kbps — balanced' },
  { value: 256, label: 'High', hint: '256 kbps — better quality' },
  { value: 320, label: 'Very High', hint: '320 kbps — best quality' },
];

function Section({ title, subtitle, children, inset = false }) {
  return (
    <section className="px-4 py-5 border-b border-white/[0.07]">
      <h2 className="text-[17px] font-extrabold tracking-tight">{title}</h2>
      {subtitle && (
        <p className="text-[12.5px] text-spotify-text-subdued mt-0.5">{subtitle}</p>
      )}
      {/* inset === true nests the child options inside a subtle card so the
          section heading reads as the parent and the rows as its children —
          the main/child hierarchy the flat list was missing. */}
      <div
        className={
          inset
            ? 'mt-3 rounded-xl bg-white/[0.035] px-3 divide-y divide-white/[0.05]'
            : 'mt-3'
        }
      >
        {children}
      </div>
    </section>
  );
}

/**
 * A full-width row with a native-feeling toggle. 56px tall = a comfortable tap.
 *
 * `dot` is the source's brand colour, so a toggleable source (YouTube) lines up
 * with the always-on ones above it instead of looking like a different species of
 * row.
 */
function Toggle({ label, hint, checked, onChange, disabled = false, dot = null }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 py-3 text-left disabled:opacity-50"
    >
      {dot && <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />}
      <div className="flex-1 min-w-0">
        <p className="text-[15px]">{label}</p>
        {hint && <p className="text-[12px] text-spotify-text-subdued mt-0.5 leading-snug">{hint}</p>}
      </div>
      <span
        className={`shrink-0 w-12 h-7 rounded-full p-0.5 transition-colors ${
          checked ? 'bg-spotify-essential-bright-accent' : 'bg-white/25'
        }`}
      >
        <span
          className={`block w-6 h-6 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}

/**
 * A row that opens a DEDICATED panel, stating where the setting stands on the
 * right so you don't have to open it to find out.
 *
 * These used to be accordions. An accordion for something like the equalizer is
 * the worst of both: it's too big to sit inline, and expanding it shoves every
 * setting below it down the screen. A setting with more than a switch's worth of
 * choice deserves its own screen.
 */
function PanelRow({ label, value, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 py-3.5 text-left active:bg-white/5"
    >
      <span className="flex-1 min-w-0 text-[15px]">{label}</span>
      {value != null && (
        <span className="shrink-0 text-[13px] text-spotify-text-subdued">{value}</span>
      )}
      <ChevronRight size={16} className="shrink-0 text-spotify-essential-subdued" />
    </button>
  );
}

/** A settings sub-screen: its own header, its own back button, its own scroll. */
function Panel({ title, onBack, children }) {
  return (
    <div className="flex flex-col h-full bg-spotify-base">
      <div className="pt-safe shrink-0">
        <div className="flex items-center gap-2 px-2 pt-3 pb-2">
          <button type="button" onClick={onBack} aria-label="Back" className="tap p-2">
            <ChevronLeft size={26} />
          </button>
          <h1 className="text-2xl font-bold">{title}</h1>
        </div>
      </div>
      <div className="scroll-y pb-bars flex-1">{children}</div>
    </div>
  );
}

/** Radio row with a checkmark — the standard iOS/Android single-select pattern. */
function Choice({ label, hint, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="w-full flex items-center gap-3 py-3 text-left active:bg-white/5"
    >
      <div className="flex-1 min-w-0">
        <p className={`text-[15px] ${selected ? 'text-spotify-essential-bright-accent' : 'text-white'}`}>
          {label}
        </p>
        {hint && <p className="text-[12px] text-spotify-text-subdued mt-0.5">{hint}</p>}
      </div>
      {selected && (
        <Check size={20} className="text-spotify-essential-bright-accent shrink-0" />
      )}
    </button>
  );
}

export function SettingsTab({ onClose }) {
  const settings = useAppSettings();
  // Which dedicated panel is open, if any. null = the settings list itself.
  const [panel, setPanel] = useState(null);

  const qualityLabel = QUALITIES.find((q) => Number(settings.audioQuality) === q.value)?.label;
  const crossfadeLabel = Number(settings.crossfadeDuration) > 0
    ? `${settings.crossfadeDuration}s`
    : 'Off';
  const eqLabel = settings.eqEnabled
    ? (EQ_PRESETS.find((p) => p.id === settings.eqPreset)?.label || 'Custom')
    : 'Off';

  // Anything with more than a switch's worth of choice gets its OWN screen, not
  // an accordion that shoves the rest of the list around when it opens. The row
  // states where the setting stands; the panel is where you change it.
  if (panel === 'quality') {
    return (
      <Panel title="Sound quality" onBack={() => setPanel(null)}>
        <Section title="Streaming bitrate" subtitle="Higher sounds better and uses more data" inset>
          {QUALITIES.map((q) => (
            <Choice
              key={q.value}
              label={q.label}
              hint={q.hint}
              selected={Number(settings.audioQuality) === q.value}
              onClick={() => writeAppSetting('audioQuality', q.value)}
            />
          ))}
        </Section>
      </Panel>
    );
  }

  if (panel === 'equalizer') {
    return (
      <Panel title="Equalizer" onBack={() => setPanel(null)}>
        <EqualizerPanel settings={settings} />
      </Panel>
    );
  }

  if (panel === 'crossfade') {
    return (
      <Panel title="Crossfade" onBack={() => setPanel(null)}>
        <Section title="Overlap" subtitle="Let one song melt into the next instead of stopping dead" inset>
          <div className="flex items-center gap-3 py-4">
            <span className="w-7 text-[11px] text-spotify-text-subdued">Off</span>
            <input
              type="range"
              min="0"
              max="12"
              step="1"
              value={Number(settings.crossfadeDuration) || 0}
              onChange={(e) => writeAppSetting('crossfadeDuration', Number(e.target.value))}
              aria-label="Crossfade duration in seconds"
              className="slider flex-1"
            />
            <span className="w-8 text-right text-[13px] font-bold tabular-nums text-white">
              {Number(settings.crossfadeDuration) || 0}s
            </span>
          </div>
        </Section>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col h-full bg-spotify-base">
      <div className="pt-safe shrink-0">
        <div className="flex items-center gap-2 px-2 pt-3 pb-2">
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Back" className="tap p-2">
              <ChevronLeft size={26} />
            </button>
          )}
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>
      </div>

      <div className="scroll-y pb-bars flex-1">
        {/* Media quality — everything about HOW the stream sounds and what the
            track rows advertise about it. Bitrate used to be its own top-level
            section and the two badges were stranded under "Playback", which had
            nothing to do with either. */}
        <Section title="Media quality" subtitle="Streaming bitrate and what's shown on tracks" inset>
          <PanelRow label="Sound quality" value={qualityLabel} onClick={() => setPanel('quality')} />
          <Toggle
            label="Source badge"
            hint="Show where each track streams from (JioSaavn, SoundCloud, YouTube)"
            checked={!!settings.showSourceBadge}
            onChange={(v) => writeAppSetting('showSourceBadge', v)}
          />
          <Toggle
            label="Quality badge"
            hint="Show the live bitrate (e.g. 320 kbps) on the now-playing screen"
            checked={!!settings.showQualityBadge}
            onChange={(v) => writeAppSetting('showQualityBadge', v)}
          />
        </Section>

        {/* Sound — everything that shapes the audio itself. */}
        <Section title="Sound" subtitle="Equalizer, crossfade and levels" inset>
          <PanelRow label="Equalizer" value={eqLabel} onClick={() => setPanel('equalizer')} />
          <PanelRow label="Crossfade" value={crossfadeLabel} onClick={() => setPanel('crossfade')} />
          <Toggle
            label="Normalize volume"
            hint="Even out loud and quiet tracks so you're not reaching for the dial"
            checked={!!settings.normalizeVolume}
            onChange={(v) => writeAppSetting('normalizeVolume', v)}
          />
        </Section>

        <Section title="Playback" inset>
          <Toggle
            label="Autoplay"
            hint="When the queue ends, keep playing songs similar to what you were listening to"
            checked={!!settings.autoplay}
            onChange={(v) => writeAppSetting('autoplay', v)}
          />
        </Section>

        <SourcesSection />

        <StorageSection />

        <UpdateSection />

        <section className="px-4 py-6">
          <button
            type="button"
            onClick={() => {
              // Resetting is destructive-ish — always confirm first.
              if (!window.confirm('Reset all settings to their defaults?')) return;
              writeAppSettings({ ...DEFAULT_SETTINGS });
              toast('Settings reset to defaults');
            }}
            className="tap flex items-center gap-2.5 text-left"
          >
            <RotateCcw size={18} className="text-spotify-essential-negative" />
            <span>
              <span className="block text-[15px] font-semibold text-spotify-essential-negative">
                Reset all settings
              </span>
              <span className="block text-[12px] text-spotify-text-subdued">
                Puts everything back to defaults
              </span>
            </span>
          </button>
        </section>

        <div className="h-6" />
      </div>
    </div>
  );
}

/**
 * In-app updates.
 *
 * Installing a new APK OVER the existing one keeps everything — playlists,
 * likes, history, resume point — because Android preserves app data across an
 * update (same package + same signing key). It's UNINSTALLING that wipes it.
 * So this flow is lossless, and the copy says so, because that's exactly the
 * thing users are afraid of.
 */
/**
 * Where downloaded songs go.
 *
 * The default is Downloads/Fix_Spotify/music so files are visible in any file
 * manager and survive an uninstall. Android 11+ only allows a real file path
 * there with All-files access, which cannot be granted from an in-app dialog —
 * the user has to flip a toggle in system Settings. So we explain WHY before
 * sending them there, and if they decline we say plainly where files land
 * instead, rather than letting downloads quietly fail.
 */
function StorageSection() {
  const [info, setInfo] = useState(null);

  const load = useCallback(() => {
    api.getDownloadsInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Coming back from the system permission screen doesn't remount us, so
  // re-check on focus — otherwise the UI would still claim access was denied.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const save = async (path) => {
    try {
      const res = await api.setDownloadsDir(path);
      if (res?.ok === false) { toast(res.error || 'Could not use that folder'); return; }
      setInfo(res);
      toast(path ? 'Download folder updated' : 'Reset to the default folder');
    } catch {
      toast('Could not change the folder');
    }
  };

  // Opens the native folder picker; the chosen path comes back from Android.
  const choose = async () => {
    const path = await pickDownloadFolder();
    if (path) save(path);
  };

  // Warn only when songs ACTUALLY landed in private storage — not merely when a
  // permission is missing, which may not matter if a custom folder is in use.
  const blocked = info?.using_fallback;

  return (
    <Section title="Storage" subtitle="Where your downloaded songs are saved">
      <div className="flex items-start gap-3 py-1">
        <HardDrive size={18} className="text-spotify-text-subdued shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px]">Downloads folder</p>
          <p className="text-[11px] text-spotify-essential-subdued break-all mt-1 leading-snug">
            {info?.path || 'Not available yet'}
          </p>

          {blocked && (
            <div className="mt-2 rounded-md bg-spotify-essential-warning/10 p-2.5">
              <p className="text-[12px] text-spotify-essential-warning leading-snug">
                Songs are going to a private app folder, which file managers can&apos;t see
                and Android deletes when you uninstall.
              </p>
              <p className="text-[12px] text-spotify-text-subdued mt-1.5 leading-snug">
                To save into Downloads/Fix_Spotify/music instead, Android needs you to
                turn on “All files access” yourself — an app can&apos;t grant it.
              </p>
              <button
                type="button"
                onClick={() => { requestStorageAccess(); toast('Turn on “All files access”, then come back'); }}
                className="tap mt-2 rounded-full bg-spotify-essential-warning px-3 py-1.5 text-[12px] font-semibold text-black"
              >
                Open Android settings
              </button>
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={choose}
              className="tap rounded-full bg-white/10 px-3 py-1.5 text-[12px] transition-colors duration-fast active:bg-white/20"
            >
              Choose folder
            </button>
            {info?.custom && (
              <button
                type="button"
                onClick={() => save('')}
                className="tap rounded-full bg-white/10 px-3 py-1.5 text-[12px] text-spotify-text-subdued"
              >
                Use default
              </button>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}

/**
 * Graphic equalizer.
 *
 * Real Web Audio filters, not a decoration — see utils/eq.js for the band layout
 * and PlayerContext for the graph. Picking a preset writes its curve; dragging
 * any band switches you to Custom, because a curve that no longer matches "Rock"
 * shouldn't keep claiming to be Rock.
 *
 * Dolby Atmos is deliberately absent. Atmos is an OEM DSP that Android exposes to
 * NATIVE audio sessions, and our audio is an <audio> element inside a WebView —
 * there is no handle to reach it with. Where a phone applies Atmos system-wide it
 * still applies here, downstream of us; we just can't offer a switch for it, and
 * a fake one would be worse than none.
 */
/**
 * The preset's curve, drawn as eight little bars.
 *
 * Each bar grows UP from the middle for a boost and DOWN for a cut, so the shape
 * you see on the card is literally the shape the sliders below will take. A row of
 * icons alone would tell you nothing about what "Jazz" actually does to the sound.
 */
function CurvePreview({ gains, active }) {
  const H = 14;                              // px, the full height a ±12dB swing spans
  return (
    <span className="flex h-3.5 items-center gap-[1.5px]" aria-hidden="true">
      {gains.map((db, i) => {
        const ratio = Math.min(1, Math.abs(db) / EQ_MAX_DB);
        // Always at least a sliver, so a flat band reads as "no change" rather
        // than as a missing bar.
        const h = Math.max(2, ratio * (H / 2));
        return (
          <span
            key={i}
            className={`w-[2px] rounded-full ${
              active ? 'bg-spotify-essential-bright-accent' : 'bg-white/40'
            }`}
            style={{
              height: `${h}px`,
              // Boost rises above the centre line, cut drops below it.
              transform: `translateY(${db >= 0 ? -h / 2 : h / 2}px)`,
            }}
          />
        );
      })}
    </span>
  );
}

function EqualizerPanel({ settings }) {
  const enabled = !!settings.eqEnabled;
  const gains = resolveGains(settings);

  // Dragging a band always lands in Custom, seeded from whatever is on screen —
  // so nudging one band of "Rock" keeps the other seven where they were.
  const setBand = (i, db) => {
    const next = normalizeGains(gains);
    next[i] = db;
    writeAppSettings({ ...settings, eqEnabled: true, eqPreset: 'custom', eqGains: next });
  };

  const pickPreset = (id) => {
    const curve = presetGains(id);
    writeAppSettings({
      ...settings,
      eqEnabled: true,
      eqPreset: id,
      // Entering Custom from a preset carries that preset's curve across, so the
      // sliders don't snap to flat the moment you tap Custom.
      eqGains: curve ? normalizeGains(curve) : normalizeGains(gains),
    });
  };

  return (
    <>
      <Section title="Equalizer" subtitle="Shape the sound across eight frequency bands" inset>
        <Toggle
          label="Enable equalizer"
          checked={enabled}
          onChange={(v) => writeAppSetting('eqEnabled', v)}
        />
      </Section>

      {/* The bands stay MOUNTED but go dim and inert when the EQ is off, rather
          than vanishing — so the panel doesn't collapse to a single switch and
          you can see what you're about to turn on. */}
      <section className={`px-4 py-5 ${enabled ? '' : 'pointer-events-none opacity-40'}`}>
        <h2 className="text-[17px] font-extrabold tracking-tight">Preset</h2>

        {/* A GRID, not a scrolling strip of chips. A rail hides half the presets
            off the edge and gives you no way to compare them; laid out flat you
            can see every option at once — and each card draws its OWN curve, so
            you can read what a preset does before committing to it. */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {EQ_PRESETS.map((p) => {
            const selected = settings.eqPreset === p.id;
            // Custom has no fixed curve — it previews whatever is dialled in now.
            const curve = p.gains || gains;
            const Icon = LucideIcons[p.icon] || LucideIcons.SlidersHorizontal;
            return (
              <button
                key={p.id}
                type="button"
                disabled={!enabled}
                aria-pressed={selected}
                onClick={() => pickPreset(p.id)}
                className={`relative flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 transition-colors duration-fast ${
                  selected
                    ? 'border-spotify-essential-bright-accent bg-spotify-essential-bright-accent/10'
                    : 'border-white/[0.08] bg-white/[0.035]'
                }`}
              >
                {selected && (
                  <Check
                    size={13}
                    strokeWidth={3}
                    className="absolute right-1.5 top-1.5 text-spotify-essential-bright-accent"
                  />
                )}
                <Icon
                  size={17}
                  className={selected ? 'text-spotify-essential-bright-accent' : 'text-spotify-text-subdued'}
                />
                <CurvePreview gains={curve} active={selected} />
                <span
                  className={`text-[10.5px] leading-none ${
                    selected ? 'font-semibold text-white' : 'text-spotify-text-subdued'
                  }`}
                >
                  {p.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Vertical sliders, one per band. `writing-mode` is the native way to
            stand an <input type=range> on end — no custom drag handling, and it
            keeps the OS's own accessibility and touch targets. */}
        <div className="mt-5 rounded-xl bg-white/[0.035] px-2 py-4">
          <div className="flex items-end justify-between gap-1">
            {EQ_BANDS.map((hz, i) => (
              <div key={hz} className="flex flex-1 flex-col items-center gap-2">
                <span className="text-[10px] tabular-nums text-spotify-text-subdued">
                  {gains[i] > 0 ? `+${gains[i]}` : gains[i]}
                </span>
                <input
                  type="range"
                  min={EQ_MIN_DB}
                  max={EQ_MAX_DB}
                  step="1"
                  disabled={!enabled}
                  value={gains[i]}
                  onChange={(e) => setBand(i, Number(e.target.value))}
                  aria-label={`${bandLabel(hz)} hertz, ${gains[i]} decibels`}
                  className="slider slider-v"
                  style={{ writingMode: 'vertical-lr', direction: 'rtl', width: '22px', height: '128px' }}
                />
                <span className="text-[10px] text-spotify-text-subdued">{bandLabel(hz)}</span>
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled={!enabled}
          onClick={() => pickPreset('flat')}
          className="tap mt-4 rounded-full bg-white/10 px-4 py-2 text-[12.5px] text-spotify-text-subdued"
        >
          Reset to flat
        </button>

        <p className="mt-4 text-[11.5px] leading-snug text-spotify-text-subdued">
          Dolby Atmos and other spatial-audio modes are applied by your phone,
          outside the app — if yours has one, it still works alongside this.
        </p>
      </section>
    </>
  );
}

/**
 * All three sources in ONE place.
 *
 * JioSaavn and SoundCloud have no switch because there is nothing to switch:
 * they need no setup and never fail to start, so a toggle would only ever offer
 * the user a way to make the app worse. They're listed anyway — a "Sources"
 * screen that shows one of the three sources is a screen that looks broken.
 */
const ALWAYS_ON = [
  { name: 'JioSaavn', hint: 'Primary catalogue · streams at 320 kbps', dot: 'bg-[#1ed760]' },
  { name: 'SoundCloud', hint: 'Remixes, sets and independent uploads', dot: 'bg-[#ff7733]' },
];

function SourcesSection() {
  return (
    <Section title="Sources" subtitle="Where your music is streamed from" inset>
      {ALWAYS_ON.map((s) => (
        <div key={s.name} className="flex items-center gap-3 py-3">
          <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
          <div className="min-w-0 flex-1">
            <p className="text-[14px]">{s.name}</p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-spotify-text-subdued">{s.hint}</p>
          </div>
          <span className="shrink-0 text-[12px] text-spotify-text-subdued">Always on</span>
        </div>
      ))}
      <YouTubeExperimentalToggle />
      <p className="py-3 text-[11.5px] leading-snug text-spotify-text-subdued">
        Everything runs on your phone over your own connection — nothing is routed
        through a server.
      </p>
    </Section>
  );
}

/**
 * YouTube. Off by default. Enabling runs a real on-device self-test (resolve an
 * actual audio stream, which is the part that needs the signature challenge
 * solved), and only flips on if that genuinely works — so the app never promises
 * YouTube on a device that can't deliver it.
 */
function YouTubeExperimentalToggle() {
  const [state, setState] = useState(null);   // { supported, enabled }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getYouTubeExperimental().then(setState).catch(() => setState({ supported: false, enabled: false }));
  }, []);

  if (!isAndroid() || !state) return null;

  const toggle = async () => {
    const next = !state.enabled;
    setBusy(true);
    if (next) toast('Testing YouTube on your device… this can take a few seconds');
    try {
      const res = await api.setYouTubeExperimental(next);
      setState((s) => ({ ...s, enabled: !!res.enabled }));
      if (next && res.ok) toast('YouTube enabled');
      else if (next && !res.ok) toast(res.error || "Couldn't enable YouTube on this device");
      else if (!next) toast('YouTube disabled');
    } catch {
      toast('Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  // Reuses the same Toggle every other setting on this screen uses. It used to be
  // a bespoke switch with its own sizing, which is why it sat differently and its
  // knob slid past the edge of the track. The Section's own divider separates it
  // from the rows above, so it needs no border of its own.
  return (
    <Toggle
      label="YouTube"
      dot="bg-[#ff4444]"
      hint={
        busy
          ? 'Checking your device…'
          : state.supported
            ? 'Adds YouTube as a search and download source. No sign-in needed.'
            : 'The YouTube extractor could not start on this device.'
      }
      checked={!!state.enabled}
      disabled={busy || !state.supported}
      onChange={toggle}
    />
  );
}

function UpdateSection() {
  const [state, setState] = useState('idle');   // idle | checking | current | found | downloading | failed
  const [info, setInfo] = useState(null);
  const [pct, setPct] = useState(0);

  const version = getAppVersion();

  useEffect(() => registerUpdateHandlers({
    onResult: (res) => {
      setInfo(res);
      setState(res?.available ? 'found' : 'current');
    },
    onProgress: (p) => {
      if (p < 0) { setState('failed'); return; }
      setPct(p);
    },
  }), []);

  // Check once on open — silent when already current, so it never nags.
  useEffect(() => {
    if (isAndroid()) {
      setState('checking');
      checkForUpdate();
    }
  }, []);

  if (!isAndroid()) return null;

  return (
    <Section title="Updates">
      <div className="flex items-start gap-3 py-1">
        <RefreshCw size={18} className="text-spotify-text-subdued shrink-0 mt-0.5" />
        {/* Fixed min-height so the section doesn't grow/shrink as the status
            text changes between states — that reflow is what made the screen
            appear to "jump" when Check again was tapped. */}
        <div className="min-w-0 flex-1 min-h-[48px]">
          {/* Both versions, always — "Version 1.3.1 is available" on its own left
              you wondering what you were actually on. */}
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13.5px] text-spotify-text-subdued">Installed</span>
            <span className="text-[13.5px] font-semibold tabular-nums">{version || '—'}</span>
          </div>
          {state === 'found' && info?.version && (
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="text-[13.5px] text-spotify-text-subdued">Latest</span>
              <span className="text-[13.5px] font-semibold tabular-nums text-spotify-essential-bright-accent">
                {info.version}
              </span>
            </div>
          )}

          <p className="text-[11.5px] text-spotify-text-subdued mt-2 leading-snug">
            {state === 'checking' && 'Checking for updates…'}
            {state === 'current' && "You're up to date."}
            {state === 'failed' && 'Update failed. Check your connection and try again.'}
            {state === 'found' &&
              'Installs over the current app — your playlists, liked songs and history are kept.'}
            {state === 'downloading' && `Downloading… ${pct}%`}
          </p>

          {state === 'found' && (
            <button
              type="button"
              onClick={() => { setState('downloading'); setPct(0); installUpdate(); }}
              className="mt-3 px-5 py-2 rounded-full bg-spotify-essential-bright-accent text-black text-[13px] font-semibold"
            >
              Download &amp; install
            </button>
          )}

          {(state === 'current' || state === 'failed' || state === 'checking') && (
            <button
              type="button"
              disabled={state === 'checking'}
              onClick={() => { setState('checking'); checkForUpdate(); }}
              className="tap mt-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2 text-[13px] font-semibold disabled:opacity-70"
            >
              {/* The icon rolls inside the button while checking — self-contained,
                  so the surrounding layout never reflows (no page "shake"). */}
              <RefreshCw size={14} className={state === 'checking' ? 'animate-spin' : ''} />
              {state === 'checking' ? 'Checking…' : 'Check again'}
            </button>
          )}

          {state === 'downloading' && (
            <div className="h-1 bg-white/10 rounded-full mt-3 overflow-hidden">
              <div
                className="h-full bg-spotify-essential-bright-accent transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
