import { useCallback } from 'react';
import { usePlayer } from '../store/PlayerContext';

/**
 * Play track `index` from `list`, and queue everything after it.
 *
 * `playTrack(track)` takes ONE argument — it starts a song but does not touch
 * the queue. Calling `playTrack(track, list, index)` looks right and does the
 * wrong thing: the extra arguments are silently ignored, so the song plays and
 * then playback simply stops, because nothing was ever queued.
 *
 * Every list in the app must therefore pair it with setQueue, exactly as the
 * desktop views do (see AlbumView/PlaylistView). This wraps that pairing so it
 * cannot be forgotten again.
 */
export function usePlayFrom() {
  const { playTrack, setQueue } = usePlayer();

  return useCallback(
    (list, index = 0) => {
      const track = list?.[index];
      if (!track) return;
      playTrack(track);
      setQueue(list.slice(index + 1));
    },
    [playTrack, setQueue]
  );
}
