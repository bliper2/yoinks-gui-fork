'use strict'

// Scores how well a YouTube Music result matches a Spotify track, 0–100.
// Pure functions, so the scoring is easy to test and tune.

// Words that mean "a different recording" unless the Spotify title has them.
const VARIANT_WORDS = ['live', 'remix', 'cover', 'karaoke', 'instrumental', 'acoustic', 'sped up', 'slowed', 'nightcore', '8d', 'reverb', 'mashup', 'edit', 'version', 'demo']

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // accents
    .replace(/\((feat|ft|with)\.?[^)]*\)|\[(feat|ft|with)\.?[^\]]*\]/g, ' ') // "(feat. X)"
    .replace(/\b(feat|ft)\.?\s.*$/, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// Remaster/year tags don't make a different song.
function coreTitle(text) {
  return normalize(text)
    .replace(/\b(\d{4} )?(remaster(ed)?|remastered version|mono|stereo|radio edit|single version|original mix|explicit|clean)\b( \d{4})?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(text) {
  return new Set(text.split(' ').filter(Boolean))
}

// Dice coefficient over word sets: 1 = same words.
function similarity(a, b) {
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.size || !tb.size) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return (2 * shared) / (ta.size + tb.size)
}

function durationScore(expectedMs, actualSeconds) {
  if (!expectedMs || !actualSeconds) return 0.5 // unknown: neutral
  const diff = Math.abs(expectedMs / 1000 - actualSeconds)
  if (diff <= 2) return 1
  if (diff <= 5) return 0.85
  if (diff <= 10) return 0.6
  if (diff <= 20) return 0.3
  return 0
}

function artistScore(expectedArtists, candidateArtist) {
  const have = normalize(candidateArtist)
  if (!expectedArtists.length || !have) return 0.5
  // Main artist matters most; featured artists are a bonus.
  const hits = expectedArtists.map(name => {
    const n = normalize(name)
    return n && (have.includes(n) || similarity(n, have) >= 0.6)
  })
  return hits[0] ? 0.8 + 0.2 * (hits.filter(Boolean).length / hits.length) : hits.some(Boolean) ? 0.5 : 0
}

/**
 * @param {{title: string, artists: string[], durationMs?: number}} track
 * @param {{title: string, artist: string, duration?: number}} candidate
 * @returns {number} 0–100
 */
function score(track, candidate) {
  const title = similarity(coreTitle(track.title), coreTitle(candidate.title))
  const artist = artistScore(track.artists ?? [], candidate.artist)
  const duration = durationScore(track.durationMs, candidate.duration)
  let total = 0.45 * title + 0.3 * artist + 0.25 * duration

  const wanted = normalize(track.title)
  const got = normalize(candidate.title)
  for (const word of VARIANT_WORDS) {
    const re = new RegExp(`\\b${word}\\b`)
    if (re.test(got) && !re.test(wanted)) total -= 0.2
  }
  return Math.max(0, Math.min(100, Math.round(total * 100)))
}

/** 'high' | 'medium' | 'low' for the confidence badge. */
function level(confidence) {
  if (confidence >= 80) return 'high'
  if (confidence >= 55) return 'medium'
  return 'low'
}

/** Candidates with confidence, best first. */
function rank(track, candidates) {
  return candidates
    .map(candidate => ({ ...candidate, confidence: score(track, candidate) }))
    .map(candidate => ({ ...candidate, level: level(candidate.confidence) }))
    .sort((a, b) => b.confidence - a.confidence)
}

module.exports = { normalize, score, level, rank }
