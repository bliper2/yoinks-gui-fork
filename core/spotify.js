'use strict'

// Spotify support without touching Spotify's audio or DRM: read the public
// metadata of a track, album, playlist or artist from its embed page, find
// the same song on YouTube Music, and let the engine download that with
// Spotify's tags and cover written in. Podcasts are found in their own
// public RSS feed instead (shows that are only on Spotify cannot be saved).

const ytdlp = require('../main/ytdlp')
const Match = require('./match')

const EMBED = 'https://open.spotify.com/embed'
const API = 'https://api.spotify.com/v1'
const PAGE_LIMIT = 2_000_000 // bytes; embed pages are ~10–300 KB
const FEED_LIMIT = 30_000_000 // bytes; long-running shows have big feeds
const SEARCH_PARALLEL = 3
const MAX_TRACKS = 500
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
const SHORT_HOSTS = new Set(['spotify.link', 'spotify.app.link'])

function parseUrl(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.hostname !== 'open.spotify.com') return null
  const m = u.pathname.match(/^\/(?:intl-[\w-]+\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]{22})\/?$/)
  return m ? { type: m[1], id: m[2] } : null
}

function isShareLink(raw) {
  try {
    return SHORT_HOSTS.has(new URL(raw).hostname)
  } catch {
    return false
  }
}

const APP_LINK_PARAMS = ['$full_url', '$fallback_url', '$desktop_url', 'S.browser_fallback_url', 'url', 'link']

/**
 * Where an "open the app" link really points: Spotify answers some visitors
 * with spotify.app.link/?$full_url=… or intent://… links that carry the web
 * page inside. Returns that open.spotify.com link, or null.
 */
function appLinkTarget(location) {
  let decoded = String(location ?? '')
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    // keep it as it is
  }
  for (const param of APP_LINK_PARAMS) {
    const escaped = param.replace(/[$.]/g, ch => `\\${ch}`)
    const m = new RegExp(`(?:[?&;#]|^)${escaped}=(https://[^&;#\\s]+)`).exec(decoded)
    if (m && parseUrl(m[1].split('?')[0])) return m[1].split('?')[0]
  }
  return null
}

/**
 * Follow a spotify.link / spotify.app.link share link to its open.spotify.com
 * page (at most 5 redirects, bodies never read). Other links come back as they are.
 */
async function resolveShareLink(raw, signal) {
  if (!isShareLink(raw)) return raw
  const inside = appLinkTarget(raw)
  if (inside) return inside
  let current = raw
  for (let hop = 0; hop < 5; hop++) {
    let response
    try {
      response = await fetch(current, { redirect: 'manual', signal, headers: { 'user-agent': UA } })
    } catch (err) {
      if (signal?.aborted) throw err
      throw new ytdlp.YoinksError({ code: 'network', message: 'Could not open that Spotify share link. Check your connection.', retryable: true, detail: err.message })
    }
    response.body?.cancel().catch(() => {})
    const location = response.headers.get('location')
    if (!location || response.status < 300 || response.status >= 400) break
    const next = appLinkTarget(location) ?? new URL(location, current).href
    if (parseUrl(next.split('?')[0])) return next.split('?')[0]
    if (!isShareLink(next)) break
    current = next
  }
  throw new ytdlp.YoinksError({ code: 'unsupported', message: 'That Spotify share link does not lead to a song, album, playlist, artist or podcast.' })
}

async function fetchPage(type, id, signal) {
  const response = await fetch(`${EMBED}/${type}/${id}`, { signal, headers: { 'user-agent': UA } }).catch(err => {
    if (signal?.aborted) throw err
    throw new ytdlp.YoinksError({ code: 'network', message: 'Could not reach Spotify. Check your connection.', retryable: true, detail: err.message })
  })
  if (response.status === 404) throw new ytdlp.YoinksError({ code: 'removed', message: 'That Spotify link does not exist or is not public.' })
  if (!response.ok) throw new ytdlp.YoinksError({ code: 'network', message: `Spotify answered with an error (${response.status}). Try again later.`, retryable: true })
  const html = await response.text()
  if (html.length > PAGE_LIMIT) throw new ytdlp.YoinksError({ code: 'unknown', message: 'Spotify sent an unexpected page.' })
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  let state
  try {
    state = JSON.parse(m[1]).props.pageProps.state
  } catch {
    state = null
  }
  if (!state?.data?.entity) throw new ytdlp.YoinksError({ code: 'unknown', message: 'Could not read that Spotify page. Spotify may have changed it; try updating Yoinks.' })
  return { entity: state.data.entity, token: state.settings?.session?.accessToken ?? null }
}

async function fetchEmbed(type, id, signal) {
  return (await fetchPage(type, id, signal)).entity
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
 * The embed page lists at most the first 100 songs. The page's anonymous
 * session can often read the rest from Spotify's Web API; Spotify does not
 * always allow it (its own editorial playlists, busy hours). Resolves the
 * extra tracks, or null when Spotify would not say.
 */
async function moreTracks(ref, token, have, signal) {
  if (!token || (ref.type !== 'playlist' && ref.type !== 'album')) return null
  const extra = []
  const fields = ref.type === 'playlist' ? '&fields=next,items(track(id,name,duration_ms,type,artists(name)))' : ''
  let next = `${API}/${ref.type}s/${ref.id}/tracks?offset=${have}&limit=${ref.type === 'playlist' ? 100 : 50}${fields}`
  try {
    while (next && have + extra.length < MAX_TRACKS) {
      const response = await fetch(next, { signal, headers: { authorization: `Bearer ${token}`, 'user-agent': UA } })
      if (!response.ok) return extra.length ? extra : null
      const page = await response.json()
      for (const item of page.items ?? []) {
        const t = ref.type === 'playlist' ? item?.track : item
        if (!t?.id || (t.type && t.type !== 'track')) continue
        extra.push({ id: t.id, title: t.name, artists: (t.artists ?? []).map(a => a.name).filter(Boolean), durationMs: t.duration_ms })
      }
      next = typeof page.next === 'string' && page.next.startsWith(API) ? page.next : null
    }
  } catch (err) {
    if (signal?.aborted) throw err
    return extra.length ? extra : null
  }
  return extra
}

/**
 * Public metadata for a Spotify link:
 * { type, title, artists, cover, year, tracks: [{ id, title, artists, durationMs, album, trackNumber }], notice }
 * `notice` says when Spotify only shared part of a long playlist.
 */
async function lookup(url, signal) {
  const ref = parseUrl(url)
  if (!ref || ref.type === 'episode' || ref.type === 'show') {
    throw new ytdlp.YoinksError({ code: 'unsupported', message: 'That is not a Spotify song, album, playlist or artist link.' })
  }
  const { entity, token } = await fetchPage(ref.type, ref.id, signal)
  const cover = largestImage(entity.visualIdentity?.image) ?? largestImage(entity.coverArt?.sources)
  const year = entity.releaseDate?.isoString?.slice(0, 4) ?? null
  const title = entity.title ?? entity.name
  // An artist page is the artist: its subtitle is not a list of names.
  const artists = ref.type === 'artist' ? [title] : artistsOf(entity)
  const isAlbum = ref.type === 'album'

  let listed =
    ref.type === 'track'
      ? [{ id: entity.id, title, artists, durationMs: entity.duration }]
      : (entity.trackList ?? [])
          .filter(t => t.entityType === 'track' || t.uri?.startsWith('spotify:track:'))
          .map(t => ({ id: t.uri?.split(':').pop() ?? null, title: t.title, artists: artistsOf(t), durationMs: t.duration }))
  let notice = null
  if (listed.length >= 100) {
    const extra = await moreTracks(ref, token, listed.length, signal)
    if (extra?.length) listed = [...listed, ...extra]
    else if (extra === null) notice = `Spotify only shared the first ${listed.length} songs of this ${ref.type}.`
  }
  if (listed.length > MAX_TRACKS) {
    notice = `Only the first ${MAX_TRACKS} songs are listed.`
    listed = listed.slice(0, MAX_TRACKS)
  }
  const tracks = listed.map((t, i) => ({ ...t, album: isAlbum ? title : null, trackNumber: isAlbum ? i + 1 : null }))
  if (!tracks.length) throw new ytdlp.YoinksError({ code: 'removed', message: 'That Spotify page has no playable tracks.' })

  // An artist's top songs come from different albums: no shared cover year.
  return { type: ref.type, title, artists, cover, year: ref.type === 'artist' ? null : year, tracks, notice }
}

/** Cover and year of one track (playlist and artist entries don't include them). */
async function trackDetails(trackId, signal) {
  if (!/^[A-Za-z0-9]{22}$/.test(trackId ?? '')) return { cover: null, year: null }
  try {
    const entity = await fetchEmbed('track', trackId, signal)
    return { cover: largestImage(entity.visualIdentity?.image), year: entity.releaseDate?.isoString?.slice(0, 4) ?? null }
  } catch {
    return { cover: null, year: null }
  }
}

// ---------- podcasts ----------

/** Text reduced to lowercase letters and digits, for comparing titles. */
function norm(text) {
  return String(text ?? '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;|&rsquo;|’/g, "'")
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const ONLY_ON_SPOTIFY = 'This podcast is only on Spotify, so Yoinks cannot save it. Shows that are also on other podcast apps work.'

/** The show's public RSS feed from Apple's podcast directory, or null when the show is not there. */
async function findFeed(showName, signal) {
  const wanted = norm(showName)
  if (!wanted) return null
  let results
  try {
    const response = await fetch(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=10&term=${encodeURIComponent(showName)}`, { signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    results = (await response.json()).results ?? []
  } catch (err) {
    if (signal?.aborted) throw err
    throw new ytdlp.YoinksError({ code: 'network', message: 'Could not look the podcast up. Check your connection and try again.', retryable: true, detail: err.message })
  }
  // Only the very same show: a near miss would save someone else's episode.
  const hit = results.find(r => norm(r.collectionName) === wanted && /^https?:\/\//.test(r.feedUrl ?? ''))
  return hit ? { feedUrl: hit.feedUrl, cover: hit.artworkUrl600 ?? null } : null
}

/** A feed's episodes: [{ title, url, date }]. */
function parseFeed(xml) {
  return String(xml)
    .split(/<item[\s>]/)
    .slice(1)
    .map(item => ({
      title: /<title>([\s\S]*?)<\/title>/.exec(item)?.[1] ?? '',
      url: /<enclosure\b[^>]*\burl="([^"]+)"/.exec(item)?.[1]?.replace(/&amp;/g, '&') ?? null,
      date: Date.parse(/<pubDate>([\s\S]*?)<\/pubDate>/.exec(item)?.[1] ?? '') || null,
    }))
    .filter(entry => entry.url && /^https?:\/\//.test(entry.url))
}

async function readFeed(feedUrl, signal) {
  let xml
  try {
    const response = await fetch(feedUrl, { signal, headers: { 'user-agent': UA } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    xml = await response.text()
  } catch (err) {
    if (signal?.aborted) throw err
    throw new ytdlp.YoinksError({ code: 'network', message: 'Could not read the podcast feed. Try again later.', retryable: true, detail: err.message })
  }
  if (xml.length > FEED_LIMIT) throw new ytdlp.YoinksError({ code: 'unknown', message: 'That podcast feed is too big to read.' })
  return parseFeed(xml)
}

/** The feed entry for a Spotify episode: the same title, or failing that a close title on the same day. */
function matchEpisode(entries, { title, date }) {
  const wanted = norm(title)
  if (!wanted) return null
  const exact = entries.find(e => norm(e.title) === wanted)
  if (exact) return exact
  const window = 36 * 60 * 60 * 1000
  return entries.find(e => date && e.date && Math.abs(e.date - date) < window && (norm(e.title).includes(wanted) || wanted.includes(norm(e.title)))) ?? null
}

/**
 * Where a Spotify podcast link can be downloaded from:
 * episode -> { kind: 'episode', url (the audio file), title, show, cover, date }
 * show    -> { kind: 'show', url (the RSS feed; yt-dlp reads it as a playlist), title }
 */
async function podcastSource(url, signal) {
  const ref = parseUrl(url)
  if (!ref || (ref.type !== 'episode' && ref.type !== 'show')) throw new ytdlp.YoinksError({ code: 'unsupported', message: 'That is not a Spotify podcast link.' })
  // A show's embed page shows its newest episode; both name the show in "subtitle".
  const entity = await fetchEmbed(ref.type, ref.id, signal)
  if (entity.isAudiobook) throw new ytdlp.YoinksError({ code: 'unsupported', message: 'Audiobooks on Spotify cannot be saved.' })
  const show = entity.subtitle ?? null
  const feed = await findFeed(show, signal)
  if (!feed) throw new ytdlp.YoinksError({ code: 'spotify-only', message: ONLY_ON_SPOTIFY })
  if (ref.type === 'show') return { kind: 'show', url: feed.feedUrl, title: show }

  const entries = await readFeed(feed.feedUrl, signal)
  const date = Date.parse(entity.releaseDate?.isoString ?? '') || null
  const episode = matchEpisode(entries, { title: entity.title ?? entity.name, date })
  if (!episode) throw new ytdlp.YoinksError({ code: 'spotify-only', message: "This episode is not in the show's public feed, so it may be only on Spotify." })
  const cover = largestImage(entity.visualIdentity?.image) ?? largestImage(entity.relatedEntityCoverArt) ?? feed.cover
  return { kind: 'episode', url: episode.url, title: entity.title ?? entity.name, show, cover, date }
}

// ---------- YouTube Music matches ----------

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

module.exports = { parseUrl, isShareLink, appLinkTarget, resolveShareLink, lookup, trackDetails, findMatches, applyMetadata, podcastSource, parseFeed, matchEpisode, norm }
