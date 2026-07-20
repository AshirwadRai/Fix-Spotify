<script setup>
// A film strip of feature cards that scrolls itself. The list is duplicated
// once and the track translates exactly -50%, so the loop is seamless with no
// JS timer and no clone-shuffling on each frame.
const frames = [
  {
    tag: 'Search',
    title: 'Three sources, one row',
    body: 'JioSaavn, SoundCloud and YouTube answer at once. Duplicates collapse — the extras stay on as backups.',
  },
  {
    tag: 'Playback',
    title: 'Double-tap to skip',
    body: 'Tap the artwork: left rewinds 10s, right jumps forward. Keep tapping and it stacks −10 → −20 → −30.',
  },
  {
    tag: 'Playback',
    title: 'Swipe the mini player',
    body: 'Left for next, right for previous. No expanding, no aiming at a small button.',
  },
  {
    tag: 'Sound',
    title: 'Eight-band equalizer',
    body: 'Eleven presets plus a custom curve. Clamped to ±12 dB so a heavy bass boost stays punchy, never muddy.',
  },
  {
    tag: 'Lyrics',
    title: 'Lyrics that follow',
    body: 'Synced line by line. Tap any line to jump straight to that moment in the song.',
  },
  {
    tag: 'Import',
    title: 'Paste a Spotify link',
    body: 'Playlist, album or track. The app matches every song against the sources and saves it as yours.',
  },
  {
    tag: 'Offline',
    title: 'Downloads, tagged right',
    body: 'A download embeds exactly what the player showed — same artist, album and artwork.',
  },
  {
    tag: 'Fallback',
    title: 'Streams that recover',
    body: 'When one source dies or is region-blocked, the next takes over. The music does not stop.',
  },
];

const loop = [...frames, ...frames];
</script>

<template>
  <section class="fs-reel" aria-label="Feature highlights">
    <div class="fs-reel-viewport">
      <div class="fs-reel-track">
        <article
          v-for="(f, i) in loop"
          :key="i"
          class="fs-frame"
          :aria-hidden="i >= frames.length ? 'true' : undefined"
        >
          <div class="fs-frame-top">
            <span class="fs-tag">{{ f.tag }}</span>
            <svg class="fs-eq" viewBox="0 0 24 16" aria-hidden="true">
              <rect
                v-for="(h, b) in [8, 14, 11, 16, 6]"
                :key="b"
                class="fs-eq-bar"
                :x="b * 5"
                :y="(16 - h) / 2"
                width="3"
                :height="h"
                rx="1.5"
                :style="{ animationDelay: `${b * 0.13}s` }"
              />
            </svg>
          </div>
          <h3>{{ f.title }}</h3>
          <p>{{ f.body }}</p>
        </article>
      </div>
    </div>
    <p class="fs-reel-hint">Hover to pause</p>
  </section>
</template>

<style scoped>
.fs-reel {
  margin: 4rem auto 2rem;
  max-width: 1152px;
  padding: 0 24px;
}

.fs-reel-viewport {
  overflow: hidden;
  position: relative;
  /* Sprocket holes, top and bottom — the thing that makes it read as film
   * rather than as a generic carousel. Pure gradient, no image asset. */
  padding: 18px 0;
  background:
    repeating-linear-gradient(
        90deg,
        var(--vp-c-bg-alt) 0 10px,
        transparent 10px 24px
      )
      0 0 / 100% 8px no-repeat,
    repeating-linear-gradient(
        90deg,
        var(--vp-c-bg-alt) 0 10px,
        transparent 10px 24px
      )
      0 100% / 100% 8px no-repeat;
  border-block: 1px solid var(--vp-c-divider);
  /* Fade the strip out at both edges so cards enter and leave, rather than
   * getting visibly chopped by the container. */
  mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent);
}

.fs-reel-track {
  display: flex;
  gap: 16px;
  width: max-content;
  animation: fs-roll 46s linear infinite;
}

.fs-reel-viewport:hover .fs-reel-track {
  animation-play-state: paused;
}

@keyframes fs-roll {
  to {
    transform: translateX(-50%);
  }
}

.fs-frame {
  flex: 0 0 300px;
  padding: 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
}

.fs-frame-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.fs-tag {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fs-accent);
}

.fs-eq {
  width: 24px;
  height: 16px;
  fill: var(--fs-accent-2);
}

.fs-frame h3 {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.3;
}

.fs-frame p {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

.fs-reel-hint {
  margin-top: 10px;
  text-align: center;
  font-size: 12px;
  color: var(--vp-c-text-3);
}

/* The strip only earns its space when it can show a few frames at once. */
@media (max-width: 640px) {
  .fs-frame {
    flex-basis: 250px;
  }
}
</style>
