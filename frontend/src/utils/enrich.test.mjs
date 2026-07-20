// applyEnrichment must be ADDITIVE. Run: node src/utils/enrich.test.mjs
//
// The bug this locks down was visible on screen: a SoundCloud track ("In Peace"
// from the album "Winter", with the uploader's own cover) was enriched against a
// WRONG iTunes match — a "Summer Chills" compilation carrying a Chill Mix of the
// same song. Because iTunes supplies 600/300 artwork keys, which outrank
// `source:soundcloud` in ARTWORK_PRIORITY, the album and the cover art of the
// song currently playing silently changed to a different record's.
//
// Enrichment cannot verify it matched the right release, so it must never
// overrule metadata the source already gave us.

import assert from 'node:assert/strict';
import { applyEnrichment, getBestArtworkUrl } from './tracks.js';

const soundcloudTrack = {
  title: 'In Peace',
  artist: 'Cold Blue',
  album: 'Winter',
  sources: { soundcloud: { url: 'https://soundcloud.com/coldblue/in-peace' } },
  artwork_urls: { 'source:soundcloud': 'https://sc/winter.jpg' },
};

// A confidently WRONG enrichment: right song name, wrong release.
const wrongEnrichment = {
  artist: 'Cold Blue',
  album: 'Summer Chills',
  artwork: { 600: 'https://itunes/summer-chills-600.jpg', 300: 'https://itunes/summer-chills-300.jpg' },
  genre: 'Trance',
  release_date: '2019-06-01',
  isrc: 'XX1234567890',
};

const out = applyEnrichment(soundcloudTrack, wrongEnrichment);

// The source's own album and cover MUST survive.
assert.equal(out.album, 'Winter', 'enrichment overwrote the album');
assert.equal(out.artist, 'Cold Blue');
assert.equal(getBestArtworkUrl(out), 'https://sc/winter.jpg', 'enrichment hijacked the cover art');
assert.ok(!out.artwork_urls['600'], 'hi-res art from a wrong match must not be added');

// Genuinely-empty fields still get filled — that is the whole point of enriching.
assert.equal(out.genre, 'Trance');
assert.equal(out.release_date, '2019-06-01');
assert.equal(out.isrc, 'XX1234567890');
assert.equal(out._enriched, true, 'must mark enriched so it runs once per track');

// A track with NO artwork of its own is the case enrichment exists for.
const bare = { title: 'X', artist: '', album: '', sources: { youtube: { url: 'u' } } };
const filled = applyEnrichment(bare, wrongEnrichment);
assert.equal(getBestArtworkUrl(filled), 'https://itunes/summer-chills-600.jpg');
assert.equal(filled.artist, 'Cold Blue', 'an empty artist should be filled');
assert.equal(filled.album, 'Summer Chills', 'an empty album should be filled');

// Degenerate input must not throw or damage the track.
assert.deepEqual(applyEnrichment(soundcloudTrack, null), soundcloudTrack);
assert.equal(applyEnrichment(null, wrongEnrichment), null);

console.log('OK: enrichment fills blanks and never overwrites the source');
