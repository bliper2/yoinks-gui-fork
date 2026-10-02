'use strict'

// Spotify support without touching Spotify's audio or DRM: read the public
// metadata of a track, album or playlist from its embed page, find the same
// song on YouTube Music, and let the engine download that with Spotify's
// tags and cover written in.

const ytdlp = require('../main/ytdlp')
const Match = require('./match')

const EMBED = 'https://open.spotify.com/embed'
const PAGE_LIMIT = 2_000_000 // bytes; embed pages are ~10–300 KB
const SEARCH_PARALLEL = 3

function parseUrl(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.hostname !== 'open.spotify.com') return null
  const m = u.pathname.match(/^\/(?:intl-[\w-]+\/)?(track|album|playlist)\/([A-Za-z0-9]{22})\/?$/)
  return m ? { type: m[1], id: m[2] } : null
}

async function fetchEmbed(type, id, signal) {
  const response = await fetch(`${EMBED}/${type}/${id}`, {
    signal,
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' },
  }).catch(err => {
    throw new ytdlp.YoinksError({ code: 'network', message: 'Could not reach Spotify. Check your connection.', retryable: true, detail: err.message })
  })
  if (response.status === 404) throw new ytdlp.YoinksError({ code: 'removed', message: 'That Spotify link does not exist or is not public.' })
  if (!response.ok) throw new ytdlp.YoinksError({ code: 'network', message: `Spotify answered with an error (${response.status}). Try again later.`, retryable: true })
  const html = await response.text()
  if (html.length > PAGE_LIMIT) throw new ytdlp.YoinksError({ code: 'unknown', message: 'Spotify sent an unexpected page.' })
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  let entity
  try {
    entity = JSON.parse(m[1]).props.pageProps.state.data.entity
  } catch {
    entity = null
  }
  if (!entity) throw new ytdlp.YoinksError({ code: 'unknown', message: 'Could not read that Spotify page. Spotify may have changed it; try updating Yoinks.' })
  return entity
}

function largestImage(images) {
  const list = (images ?? []).filter(img => typeof img?.url === 'string' && img.url.startsWith('https://'))
  return list.sort((a, b) => (b.maxWidth ?? b.width ?? 0) - (a.maxWidth ?? a.width ?? 0))[0]?.url ?? null
}

function artistsOf(entity) {
  if (Array.isArray(entity.artists)) return entity.artists.map(a => a.name).filter(Boolean)
  return String(entity.subtitle ?? '')
    .split(/,\s*/)
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * Public metadata for a Spotify link:
 * { type, title, artists, cover, year, tracks: [{ id, title, artists, durationMs, album, trackNumber }] }
 * Embed pages list at most the first ~50–100 tracks of big playlists.
 */
async function lookup(url, signal) {
  const ref = parseUrl(url)
  if (!ref) throw new ytdlp.YoinksError({ code: 'unsupported', message: 'That is not a Spotify track, album or playlist link.' })
  const entity = await fetchEmbed(ref.type, ref.id, signal)
  const cover = largestImage(entity.visualIdentity?.image) ?? largestImage(entity.coverArt?.sources)
  const year = entity.releaseDate?.isoString?.slice(0, 4) ?? null
  const artists = artistsOf(entity)

  const tracks =
    ref.type === 'track'
      ? [{ id: entity.id, title: entity.title ?? entity.name, artists, durationMs: entity.duration, album: null, trackNumber: null }]
      : (entity.trackList ?? [])
          .filter(t => t.entityType === 'track' || t.uri?.startsWith('spotify:track:'))
          .map((t, i) => ({
            id: t.uri?.split(':').pop() ?? null,
            title: t.title,
            artists: artistsOf(t),
            durationMs: t.duration,
            album: ref.type === 'album' ? (entity.title ?? entity.name) : null,
            trackNumber: ref.type === 'album' ? i + 1 : null,
          }))
  if (!tracks.length) throw new ytdlp.YoinksError({ code: 'removed', message: 'That Spotify page has no playable tracks.' })

  return { type: ref.type, title: entity.title ?? entity.name, artists, cover, year, tracks }
}

/** Cover and year of one track (playlist entries don't include them). */
async function trackDetails(trackId, signal) {
  if (!/^[A-Za-z0-9]{22}$/.test(trackId ?? '')) return { cover: null, year: null }
  try {
    const entity = await fetchEmbed('track', trackId, signal)
    return { cover: largestImage(entity.visualIdentity?.image), year: entity.releaseDate?.isoString?.slice(0, 4) ?? null }
  } catch {
    return { cover: null, year: null }
  }
}

/**
 * YouTube Music candidates for each track, ranked by confidence. Calls
 * onProgress(done, total) as tracks are matched.
 */
async function findMatches(bin, tracks, { signal, settings, onProgress = () => {} }) {
  const results = new Array(tracks.length)
  let next = 0
  let done = 0
  let failed = 0
  let firstError = null
  const limit = tracks.length === 1 ? 5 : 3
  async function worker() {
    while (next < tracks.length) {
      const i = next++
      const track = tracks[i]
      let candidates = []
      try {
        candidates = await ytdlp.searchMusic(bin, `${track.artists[0] ?? ''} ${track.title}`.trim(), { limit, signal, settings })
      } catch (err) {
        if (signal?.aborted) throw err
        failed++
        firstError ??= err
      }
      results[i] = Match.rank(track, candidates)
      onProgress(++done, tracks.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(SEARCH_PARALLEL, tracks.length) }, worker))
  // Every search failing (offline, yt-dlp broken) is an error, not "no matches".
  if (failed === tracks.length && firstError) throw firstError
  return results
}

/**
 * Put Spotify's metadata onto a YouTube Music info dict so yt-dlp writes it
 * (tags, cover, file name) exactly like any other download.
 */
function applyMetadata(info, { track, entity, index, cover, year }) {
  const artist = track.artists.join(', ')
  const patched = {
    ...info,
    title: track.title,
    track: track.title,
    artist,
    artists: track.artists,
    creator: artist,
    creators: track.artists,
    album: track.album ?? info.album ?? null,
    album_artist: entity.type === 'album' ? entity.artists.join(', ') : (info.album_artist ?? null),
    track_number: track.trackNumber ?? null,
    release_year: year ? Number(year) : (info.release_year ?? null),
    upload_date: year ? `${year}0101` : info.upload_date,
    playlist_title: entity.type === 'track' ? null : entity.title,
    playlist_index: entity.type === 'track' ? null : index + 1,
  }
  if (cover) {
    patched.thumbnail = cover
    patched.thumbnails = [{ url: cover, id: 'spotify' }]
  }
  return patched
}

module.exports = { parseUrl, lookup, trackDetails, findMatches, applyMetadata }
