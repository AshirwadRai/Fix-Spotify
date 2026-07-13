import { useState, useEffect, useCallback } from 'react';
import { Check, RotateCcw, HardDrive, Info, ChevronLeft, RefreshCw } from 'lucide-react';
import {
  useAppSettings, writeAppSetting, writeAppSettings, DEFAULT_SETTINGS,
} from '../../utils/settings';
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

/** A full-width row with a native-feeling toggle. 56px tall = a comfortable tap. */
function Toggle({ label, hint, checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-4 py-3 text-left"
    >
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

      <div className="scroll-y flex-1">
        <Section title="Audio Quality" subtitle="Choose preferred streaming bitrate" inset>
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

        <Section title="Crossfade" subtitle="Let one song melt into the next">
          <div className="flex items-center gap-4">
            <span className="text-[12px] text-spotify-text-subdued w-8">Off</span>
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
            <span className="w-10 text-right text-[13px] font-bold tabular-nums text-white">
              {Number(settings.crossfadeDuration) > 0 ? `${settings.crossfadeDuration}s` : '0s'}
            </span>
          </div>
        </Section>

        <Section title="Playback" subtitle="Autoplay and display options" inset>
          <Toggle
            label="Autoplay"
            hint="When your queue ends, keep playing songs similar to what you were listening to"
            checked={!!settings.autoplay}
            onChange={(v) => writeAppSetting('autoplay', v)}
          />
          <Toggle
            label="Normalize Volume"
            hint="Even out loud and quiet parts for a more consistent listening volume"
            checked={!!settings.normalizeVolume}
            onChange={(v) => writeAppSetting('normalizeVolume', v)}
          />
          <Toggle
            label="Show Source Badge"
            hint="Display the source indicator (JioSaavn, SoundCloud) on tracks"
            checked={!!settings.showSourceBadge}
            onChange={(v) => writeAppSetting('showSourceBadge', v)}
          />
          <Toggle
            label="Show Quality Badge"
            hint="Show the streaming bitrate (e.g. 320) on the now-playing screen"
            checked={!!settings.showQualityBadge}
            onChange={(v) => writeAppSetting('showQualityBadge', v)}
          />
        </Section>

        <StorageSection />

        {/* The desktop build has a YouTube section here. It is deliberately absent:
            YouTube needs a JavaScript runtime (Deno) to solve its signature
            challenge, and there is none for Android. Saying so beats leaving the
            user wondering where the option went. */}
        <Section title="Sources">
          <div className="flex items-start gap-3 py-1">
            <Info size={18} className="text-spotify-text-subdued shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[14px]">JioSaavn · SoundCloud</p>
              <p className="text-[12px] text-spotify-text-subdued mt-1 leading-snug">
                Everything runs on your phone, using your own connection — nothing is
                routed through a server.
              </p>
              <p className="text-[12px] text-spotify-text-subdued mt-2 leading-snug">
                JioSaavn streams at 320 kbps. YouTube is available as an experiment
                below.
              </p>
            </div>
          </div>
          <YouTubeExperimentalToggle />
        </Section>

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
    <Section title="Storage" subtitle="Where your downloaded songs hang out 🎧">
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
 * Experimental YouTube. Off by default. Enabling runs an on-device self-test
 * (extract a real video through the WebView's V8), and only flips on if that
 * genuinely works — so we never promise YouTube on a device that can't do it.
 */
function YouTubeExperimentalToggle() {
  const [state, setState] = useState(null);   // { supported, enabled }
  const [busy, setBusy] = useState(false);
  const [cookies, setCookies] = useState(false);

  useEffect(() => {
    api.getYouTubeExperimental().then(setState).catch(() => setState({ supported: false, enabled: false }));
    api.getYouTubeCookies().then((r) => setCookies(!!r.present));
  }, []);

  // Read the picked cookies.txt in the WebView and hand the text to the backend.
  const importCookies = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const content = await file.text();
      const res = await api.setYouTubeCookies(content);
      if (res.ok) { setCookies(true); toast('YouTube cookies imported'); }
      else toast(res.error || 'Could not use that file');
    } catch {
      toast('Could not read that file');
    }
  };

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

  return (
    <div className="mt-3 border-t border-white/10 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px]">
            YouTube <span className="text-[10px] uppercase tracking-wide text-spotify-essential-warning">Beta</span>
          </p>
          <p className="text-[12px] text-spotify-text-subdued mt-0.5 leading-snug">
            {busy
              ? 'Checking your device…'
              : state.supported
                ? 'Solves YouTube’s challenge on-device with a built-in JS engine. May be slower.'
                : 'The JS engine could not start on this device.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={state.enabled}
          disabled={busy || !state.supported}
          onClick={toggle}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-fast disabled:opacity-40 ${
            state.enabled ? 'bg-spotify-essential-bright-accent' : 'bg-white/20'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-fast ${
              state.enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {/* cookies.txt — the auth fallback for "confirm you're not a bot". */}
      {state.supported && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[12px] text-spotify-text-subdued leading-snug">
            {cookies
              ? 'Signed-in cookies imported — used when YouTube asks for a login.'
              : 'If YouTube blocks playback, export cookies.txt from a browser signed in to YouTube (on a PC) and import it here.'}
          </p>
          {cookies ? (
            <button
              type="button"
              onClick={async () => { await api.setYouTubeCookies(''); setCookies(false); toast('Cookies removed'); }}
              className="tap shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[12px]"
            >
              Remove
            </button>
          ) : (
            <label className="tap shrink-0 cursor-pointer rounded-full bg-white/10 px-3 py-1.5 text-[12px]">
              Import cookies.txt
              <input type="file" accept=".txt,text/plain" className="sr-only" onChange={importCookies} />
            </label>
          )}
        </div>
      )}
    </div>
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
          <p className="text-[14px]">
            {state === 'found'
              ? `Version ${info.version} is available`
              : `You're on version ${version || '—'}`}
          </p>

          <p className="text-[12px] text-spotify-text-subdued mt-1 leading-snug">
            {state === 'checking' && 'Checking for updates…'}
            {state === 'current' && "You're up to date."}
            {state === 'failed' && 'Update failed. Check your connection and try again.'}
            {state === 'found' &&
              'Updating installs over the current app — your playlists, liked songs and history are kept.'}
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
