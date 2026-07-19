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
      'Importing from Spotify now shows live progress and keeps going in the background — leave the screen and come back without losing your place.',
      'Lock-screen and Bluetooth controls respond instantly and stay in sync, even after the app has been idle a while.',
      'Some SoundCloud songs that played silently now play correctly.',
      'Pinned playlists and albums sit together at the top of your library.',
      'Real artist photos when a song has several artists, and playlist covers when adding a song.',
      'New in Settings: Tips & shortcuts, and a tidy version history under What’s new.',
      'Songs start faster, with a cleaner startup screen and in-app dialogs.',
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
