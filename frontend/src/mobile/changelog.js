// Release notes shown in the "What's new" dialog after an update.
//
// Newest entry FIRST. `version` must match the installed versionName exactly
// (what getAppVersion() returns, e.g. "1.3.8"). Keep highlights short, plain
// and user-facing — what changed for THEM, not the commit log.
//
// Add a new entry here every time you tag a release; that is the whole
// maintenance cost. If a build's version has no entry, the dialog simply falls
// back to the newest one below.

export const CHANGELOG = [
  {
    version: '1.4.2',
    highlights: [
      'Some SoundCloud songs that played silently now play correctly.',
      'Lock-screen and Bluetooth controls respond instantly and stay in sync — even after the app has been idle for a while.',
      'Pinned playlists and albums now sit together at the very top of your library.',
      'Songs start faster, with less delay before the music begins.',
      'New: Tips & shortcuts, and this update history, live in Settings.',
      'A cleaner startup screen and in-app dialogs.',
    ],
  },
  {
    version: '1.3.7',
    highlights: [
      'Fixed songs pausing on their own the moment they started on some phones.',
      'Music no longer keeps playing out loud when headphones disconnect.',
    ],
  },
];

/** The entry for a version, or the newest entry if that version has none. */
export function changelogFor(version) {
  if (!CHANGELOG.length) return null;
  return CHANGELOG.find((c) => c.version === version) || CHANGELOG[0];
}
