import { useState, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import { readAppSettings, writeAppSettings, DEFAULT_SETTINGS } from '../utils/settings';
import { api } from '../api';
import { isTauri } from '../utils/config';

/**
 * Section shell shared by every settings block, matching the Android build:
 * a plain bold title + subtitle over a divider, no coloured icon chip. The
 * desktop settings used a different tinted chip per section (green/purple/blue/
 * red), which read as five unrelated widgets — this is the single, calm look the
 * app uses everywhere else.
 */
function Section({ title, subtitle, children }) {
  return (
    <section className="border-b border-white/[0.07] py-6">
      <h2 className="text-[17px] font-extrabold tracking-tight text-white">{title}</h2>
      {subtitle && <p className="mt-0.5 text-[12.5px] text-spotify-text-subdued">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Check for updates from Settings — the desktop counterpart of the mobile
 * updater. Uses tauri-plugin-updater: it fetches the signed latest.json the CI
 * publishes, verifies it against the pubkey baked into tauri.conf.json, then
 * downloads and installs over the current app. Local data (playlists, likes,
 * history) lives in the OS webview store and is untouched by the swap.
 */
function UpdatesSection() {
  const [version, setVersion] = useState('');
  // idle | checking | available | downloading | uptodate | error | ready
  const [state, setState] = useState('idle');
  const [info, setInfo] = useState(null);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (!isTauri()) return;
    import('@tauri-apps/api/app')
      .then((m) => m.getVersion())
      .then(setVersion)
      .catch(() => {});
  }, []);

  if (!isTauri()) return null;   // web/dev build has nothing to update

  const check = async () => {
    setState('checking');
    try {
      const { check: checkUpdate } = await import('@tauri-apps/plugin-updater');
      const update = await checkUpdate();
      if (update) {
        setInfo(update);
        setState('available');
      } else {
        setState('uptodate');
      }
    } catch (e) {
      console.error('update check failed', e);
      setState('error');
    }
  };

  const install = async () => {
    if (!info) return;
    setState('downloading');
    setPct(0);
    try {
      let total = 0;
      let got = 0;
      // downloadAndInstall streams progress events as it fetches the installer.
      await info.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength || 0;
        else if (event.event === 'Progress') {
          got += event.data.chunkLength || 0;
          if (total) setPct(Math.round((got / total) * 100));
        }
      });
      setState('ready');
      // Relaunch into the new version. "nvm if it asks for restart" — this IS the
      // restart, done for the user.
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      console.error('update install failed', e);
      setState('error');
    }
  };

  return (
    <Section
      title="Updates"
      subtitle={state === 'available'
        ? `Version ${info?.version} is available`
        : `You're on version ${version || '—'}`}
    >
      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-sm text-spotify-text-subdued mb-3">
          {state === 'checking' && 'Checking for updates…'}
          {state === 'uptodate' && "You're up to date."}
          {state === 'error' && 'Update check failed. Check your connection and try again.'}
          {state === 'available' && 'Installing keeps your playlists, liked songs and history.'}
          {state === 'downloading' && `Downloading… ${pct}%`}
          {state === 'ready' && 'Restarting into the new version…'}
          {state === 'idle' && 'Get the latest features and fixes.'}
        </p>

        {state === 'downloading' ? (
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-green-400 transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        ) : (
          <button
            onClick={state === 'available' ? install : check}
            disabled={state === 'checking' || state === 'ready'}
            className="px-4 py-2 rounded-md text-sm font-semibold text-black bg-spotify-essential-bright-accent hover:brightness-110 transition-all disabled:opacity-50"
          >
            {state === 'available' ? 'Download & install' : state === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        )}
      </div>
    </Section>
  );
}

const QUALITY_OPTIONS = [
  { value: 0, label: 'Auto', desc: 'Adjusts automatically based on source' },
  { value: 96, label: 'Low', desc: '96 kbps — saves bandwidth' },
  { value: 128, label: 'Normal', desc: '128 kbps — balanced' },
  { value: 256, label: 'High', desc: '256 kbps — better quality' },
  { value: 320, label: 'Very High', desc: '320 kbps — best quality' },
];

export function SettingsView() {
  const [settings, setSettings] = useState(readAppSettings);

  const update = (key, value) => {
    setSettings(prev => writeAppSettings({ ...prev, [key]: value }));
  };

  const resetAll = () => {
    setSettings(writeAppSettings({ ...DEFAULT_SETTINGS }));
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-8 pt-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">Settings</h1>

        <UpdatesSection />

        {/* ── Audio Quality ── */}
        <Section title="Audio quality" subtitle="Choose preferred streaming bitrate">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {QUALITY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => update('audioQuality', opt.value)}
                className={`flex flex-col items-start p-3.5 rounded-lg border transition-all text-left
                  ${settings.audioQuality === opt.value
                    ? 'border-spotify-essential-bright-accent bg-spotify-essential-bright-accent/10'
                    : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'}`}
              >
                <span className={`text-sm font-semibold ${settings.audioQuality === opt.value ? 'text-spotify-essential-bright-accent' : 'text-white'}`}>
                  {opt.label}
                </span>
                <span className="text-xs text-spotify-text-subdued mt-0.5">{opt.desc}</span>
              </button>
            ))}
          </div>
        </Section>

        {/* ── Crossfade ── */}
        <Section title="Crossfade" subtitle="Smoothly fade between tracks">
          <div className="bg-white/5 rounded-lg p-4 border border-white/10">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-white">Duration</span>
              <span className="text-sm font-mono text-spotify-essential-bright-accent font-semibold">
                {settings.crossfadeDuration === 0 ? 'Off' : `${settings.crossfadeDuration}s`}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="12"
              step="1"
              value={settings.crossfadeDuration}
              onChange={(e) => update('crossfadeDuration', Number(e.target.value))}
              className="w-full h-1 rounded-full appearance-none cursor-pointer"
              style={{
                // White-before-thumb, grey after — the same neutral fill the
                // Android build uses, instead of the lone green gradient.
                background: `linear-gradient(to right, #fff ${(settings.crossfadeDuration / 12) * 100}%, rgba(255,255,255,0.25) ${(settings.crossfadeDuration / 12) * 100}%)`,
              }}
            />
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-spotify-text-subdued">Off</span>
              <span className="text-[10px] text-spotify-text-subdued">12s</span>
            </div>
          </div>
        </Section>

        {/* ── Playback Toggles ── */}
        <Section title="Playback" subtitle="Audio normalization and display options">
          <div className="space-y-1">
            <ToggleRow
              label="Autoplay"
              description="When your queue ends, keep playing songs similar to what you were listening to"
              checked={settings.autoplay}
              onChange={(v) => update('autoplay', v)}
            />
            <ToggleRow
              label="Normalize Volume"
              description="Even out loud and quiet parts for a more consistent listening volume"
              checked={settings.normalizeVolume}
              onChange={(v) => update('normalizeVolume', v)}
            />
            <ToggleRow
              label="Show Source Badge"
              description="Display source indicator (JioSaavn, YouTube, etc.) on tracks"
              checked={settings.showSourceBadge}
              onChange={(v) => update('showSourceBadge', v)}
            />
          </div>
        </Section>

        {/* ── YouTube connection (opt-in) ── */}
        <YouTubeSection />

        {/* ── Reset ── */}
        <section className="pt-6">
          <button
            onClick={resetAll}
            className="flex items-center gap-2 text-sm text-spotify-text-subdued hover:text-white transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reset all settings to defaults
          </button>
        </section>
      </div>
    </div>
  );
}

// Matches the Android toggle: a right-aligned pill switch, no bordered card.
function ToggleRow({ label, description, checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-4 py-3 text-left"
    >
      <div className="min-w-0 flex-1">
        <span className="text-[15px] text-white">{label}</span>
        {description && <p className="mt-0.5 text-[12px] leading-snug text-spotify-text-subdued">{description}</p>}
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

// Optional YouTube sign-in. Off by default — the app streams from JioSaavn +
// SoundCloud without it. Power users connect their browser's YouTube login so
// yt-dlp can stream otherwise bot-blocked YouTube-only tracks; connecting also
// stops the search ranking from demoting those tracks (they become playable).
function YouTubeSection() {
  const [status, setStatus] = useState({ connected: false, browser: null, browsers: [] });
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.youtubeStatus().then(s => {
      setStatus(s);
      setChoice(s.browser || s.browsers?.[0] || '');
    });
  }, []);

  const connect = async () => {
    if (!choice) return;
    setBusy(true); setError('');
    const r = await api.youtubeConnect(choice);
    setBusy(false);
    if (r.connected) setStatus(s => ({ ...s, connected: true, method: 'browser', browser: r.browser }));
    else setError(r.error || 'Could not connect');
  };

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the user re-pick the same file later
    if (!file) return;
    setBusy(true); setError('');
    try {
      const content = await file.text();
      const r = await api.youtubeConnectFile(content);
      setBusy(false);
      if (r.connected) setStatus(s => ({ ...s, connected: true, method: 'file', browser: null }));
      else setError(r.error || 'Could not import cookies');
    } catch (err) {
      setBusy(false);
      setError(String(err));
    }
  };

  const disconnect = async () => {
    setBusy(true); setError('');
    await api.youtubeDisconnect();
    setBusy(false);
    setStatus(s => ({ ...s, connected: false, method: null, browser: null }));
  };

  const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

  return (
    <Section title="YouTube" subtitle="Optional — for full coverage of tracks only on YouTube">
      <div className="bg-white/5 rounded-lg p-4 border border-white/10">
        {status.connected ? (
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <span className="text-sm font-medium text-spotify-essential-bright-accent">YouTube connected ✓</span>
              <p className="text-xs text-spotify-text-subdued mt-0.5">
                {status.method === 'file'
                  ? "Using your imported cookies.txt. YouTube-only tracks now play."
                  : `Using ${cap(status.browser)}'s login. YouTube-only tracks now play.`}
              </p>
            </div>
            <button
              onClick={disconnect}
              disabled={busy}
              className="px-3 py-1.5 rounded-md text-sm text-white bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-spotify-text-subdued mb-3">
              The app works without this — connect it only if you want tracks that
              are exclusively on YouTube. Uses your own account on your machine.
            </p>

            {/* Most robust: import a cookies.txt exported from a signed-in YouTube tab. */}
            <p className="text-sm font-medium text-white mb-1.5">Import cookies.txt</p>
            <p className="text-xs text-spotify-text-subdued mb-2">
              Sign in to YouTube in any browser, export your cookies with a
              "Get cookies.txt" extension, then import the file here. Works on every
              browser (recommended on Windows).
            </p>
            <label className={`inline-flex items-center px-4 py-2 rounded-md text-sm font-semibold text-black bg-spotify-essential-bright-accent transition-transform ${busy ? 'opacity-50' : 'hover:scale-[1.02] cursor-pointer'}`}>
              {busy ? 'Working…' : 'Choose cookies.txt'}
              <input type="file" accept=".txt,text/plain" className="hidden" disabled={busy} onChange={importFile} />
            </label>

            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-[10px] uppercase tracking-wide text-spotify-text-subdued">or use a browser login</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* Fallback: read cookies straight from a browser (flaky on Chromium/Windows). */}
            <div className="flex items-center gap-2">
              <select
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-white/30"
              >
                {(status.browsers || []).map(b => (
                  <option key={b} value={b} className="bg-spotify-base text-white">{cap(b)}</option>
                ))}
              </select>
              <button
                onClick={connect}
                disabled={busy || !choice}
                className="px-4 py-2 rounded-md text-sm font-semibold text-white bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
              >
                {busy ? 'Connecting…' : 'Use browser'}
              </button>
            </div>
            <p className="text-[11px] text-spotify-text-subdued mt-2">
              Note: Chrome, Edge and Brave encrypt cookies on Windows and often
              fail here — Firefox works, or use the cookies.txt import above.
            </p>

            {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
          </>
        )}
      </div>
    </Section>
  );
}
