'use strict'

// 3.1.0: yt-dlp gets a JavaScript runtime for YouTube, the portable app
// repairs its shortcuts, and Spotify share links, artists, long playlists
// and podcasts.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const Spotify = require('../core/spotify.js')
const Sites = require('../extension/shared/sites.js')
const Ytdlp = require('../main/ytdlp.js')
const { makeController, MEDIA } = require('./helpers.js')

const ID = 'a'.repeat(22)

// fetch replaced by a table of canned answers for one test.
function withFetch(routes, fn) {
  const real = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url))
    for (const [match, reply] of routes) {
      if (String(url).includes(match)) return typeof reply === 'function' ? reply(String(url), options) : reply
    }
    throw new Error(`no route for ${url}`)
  }
  return Promise.resolve(fn(calls)).finally(() => (globalThis.fetch = real))
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const embedPage = (entity, token = 'TOKEN') =>
  new Response(`<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity }, settings: { session: { accessToken: token } } } } } })}</script></html>`)
const listed = n => Array.from({ length: n }, (_, i) => ({ uri: `spotify:track:${String(i).padStart(22, 'x')}`, title: `Song ${i}`, subtitle: 'Someone', duration: 200_000, entityType: 'track' }))

// ---------- yt-dlp and YouTube ----------

test('yt-dlp gets our own Node as its JavaScript runtime, but only a yt-dlp that knows the option', async () => {
  assert.deepEqual(Ytdlp.jsRuntimeArgs('never-checked'), [])
  // node itself answers "--version" with "v24…", which is not a yt-dlp version from 2025.11 on.
  assert.equal(await Ytdlp.detectJsRuntime(process.execPath), false)
  assert.deepEqual(Ytdlp.jsRuntimeArgs(process.execPath), [])
})

// ---------- Spotify links ----------

test('Spotify artist, episode, show and share links are Spotify links', () => {
  assert.deepEqual(Spotify.parseUrl(`https://open.spotify.com/artist/${ID}`), { type: 'artist', id: ID })
  assert.equal(Spotify.parseUrl(`https://open.spotify.com/intl-fr/episode/${ID}`).type, 'episode')
  assert.equal(Spotify.parseUrl(`https://open.spotify.com/show/${ID}`).type, 'show')
  assert.equal(Spotify.parseUrl(`https://open.spotify.com/user/${ID}`), null)
  for (const url of [`https://open.spotify.com/artist/${ID}`, `https://open.spotify.com/show/${ID}`, 'https://spotify.link/AbC123', 'https://spotify.app.link/xyz']) {
    assert.equal(Sites.isSpotify(url), true, url)
  }
  assert.equal(Sites.isSpotify('https://open.spotify.com/search'), false)
  assert.equal(Sites.isSpotify('https://spotify.link/'), false)
  assert.equal(Sites.isPlaylistLink(`https://open.spotify.com/artist/${ID}`), true)
  assert.equal(Sites.isPlaylistLink(`https://open.spotify.com/episode/${ID}`), false)
})

test('an app link carries the Spotify page inside it', () => {
  const page = `https://open.spotify.com/track/${ID}`
  assert.equal(Spotify.appLinkTarget(`https://spotify.app.link/?$full_url=${encodeURIComponent(page + '?si=1')}`), page)
  assert.equal(Spotify.appLinkTarget(`intent://x#Intent;S.browser_fallback_url=${encodeURIComponent(page)};end`), page)
  assert.equal(Spotify.appLinkTarget('https://spotify.app.link/?$full_url=https%3A%2F%2Fevil.example%2Ftrack'), null, 'only Spotify pages')
})

test('a spotify.link share link is followed to its page', () =>
  withFetch(
    [
      ['spotify.link/AbC', () => new Response(null, { status: 307, headers: { location: `https://spotify.app.link/AbC?$full_url=${encodeURIComponent(`https://open.spotify.com/album/${ID}?si=z`)}` } })],
    ],
    async () => {
      assert.equal(await Spotify.resolveShareLink('https://spotify.link/AbC'), `https://open.spotify.com/album/${ID}`)
      assert.equal(await Spotify.resolveShareLink(`https://open.spotify.com/track/${ID}`), `https://open.spotify.com/track/${ID}`, 'other links as they are')
    },
  ))

test('a share link to the Spotify home page is refused', () =>
  withFetch([['spotify.link/home', () => new Response(null, { status: 307, headers: { location: 'https://open.spotify.com/' } })]], async () => {
    await assert.rejects(Spotify.resolveShareLink('https://spotify.link/home'), { code: 'unsupported' })
  }))

// ---------- artists and long playlists ----------

test('an artist link lists the top songs, each with its own artists', () =>
  withFetch([['/embed/artist/', () => embedPage({ type: 'artist', name: 'Pitbull', subtitle: '12M monthly listeners', trackList: listed(10) })]], async () => {
    const entity = await Spotify.lookup(`https://open.spotify.com/artist/${ID}`)
    assert.equal(entity.type, 'artist')
    assert.deepEqual(entity.artists, ['Pitbull'])
    assert.equal(entity.tracks.length, 10)
    assert.deepEqual(entity.tracks[0].artists, ['Someone'])
    assert.equal(entity.year, null)
    assert.equal(entity.notice, null)
  }))

test('a playlist longer than the embed page is read to the end', () =>
  withFetch(
    [
      ['/embed/playlist/', () => embedPage({ type: 'playlist', name: 'Big', trackList: listed(100) })],
      ['offset=100', (url, options) => {
        assert.equal(options.headers.authorization, 'Bearer TOKEN')
        return json({ items: [{ track: { id: 'b'.repeat(22), name: 'Song 100', duration_ms: 1, type: 'track', artists: [{ name: 'X' }] } }, { track: { id: 'e'.repeat(22), type: 'episode' } }], next: 'https://api.spotify.com/v1/playlists/p/tracks?offset=200' })
      }],
      ['offset=200', () => json({ items: [{ track: { id: 'c'.repeat(22), name: 'Song 101', duration_ms: 1, type: 'track', artists: [] } }], next: null })],
    ],
    async () => {
      const entity = await Spotify.lookup(`https://open.spotify.com/playlist/${ID}`)
      assert.equal(entity.tracks.length, 102)
      assert.equal(entity.tracks[100].title, 'Song 100')
      assert.equal(entity.tracks[101].id, 'c'.repeat(22))
      assert.equal(entity.notice, null)
    },
  ))

test('when Spotify will not share the rest of a playlist, the first 100 are kept and the user is told', () =>
  withFetch(
    [
      ['/embed/playlist/', () => embedPage({ type: 'playlist', name: 'Big', trackList: listed(100) })],
      ['api.spotify.com', () => json({ error: { status: 429 } }, 429)],
    ],
    async () => {
      const entity = await Spotify.lookup(`https://open.spotify.com/playlist/${ID}`)
      assert.equal(entity.tracks.length, 100)
      assert.match(entity.notice, /first 100 songs/)
    },
  ))

test("Spotify's notice reaches the user as a toast", async () => {
  const t = makeController()
  await t.controller.ready
  await t.controller.command({ type: 'lookup', url: `https://open.spotify.com/playlist/${ID}` })
  t.send(t.lastChannel(), { type: 'probed', kind: 'spotify', title: 'Big', tracks: [{ title: 'a', artists: [], candidates: [] }], notice: 'Spotify only shared the first 100 songs of this playlist.' })
  await t.tick()
  assert.ok(t.controller.view().toasts.some(toast => /Big: Spotify only shared the first 100/.test(toast.text)))
})

// ---------- podcasts ----------

const FEED = `<?xml version="1.0"?><rss><channel><title>Show</title>
<item><title><![CDATA[#12 - Café Talk]]></title><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate><enclosure url="https://cdn.example/12.mp3?a=1&amp;b=2" type="audio/mpeg"/></item>
<item><title>#11 - Older one</title><pubDate>Tue, 27 Oct 2026 10:00:00 GMT</pubDate><enclosure url="https://cdn.example/11.mp3" type="audio/mpeg"/></item>
<item><title>No audio</title></item>
</channel></rss>`

test('podcast feeds are read and the episode is matched by title or by day', () => {
  const entries = Spotify.parseFeed(FEED)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].url, 'https://cdn.example/12.mp3?a=1&b=2')
  assert.equal(Spotify.matchEpisode(entries, { title: '#12 – Cafe Talk', date: null }).url, entries[0].url, 'accents and dashes do not matter')
  assert.equal(Spotify.matchEpisode(entries, { title: 'Older one', date: Date.parse('2026-10-27T12:00:00Z') }).url, entries[1].url)
  assert.equal(Spotify.matchEpisode(entries, { title: 'Older one', date: Date.parse('2026-01-01') }), null, 'a close title on another day is not it')
  assert.equal(Spotify.matchEpisode(entries, { title: 'Something else', date: null }), null)
})

test('a Spotify episode is found in its show’s public feed', () =>
  withFetch(
    [
      ['/embed/episode/', () => embedPage({ type: 'episode', title: '#12 - Café Talk', subtitle: 'The Show', releaseDate: { isoString: '2026-11-03T10:00:00Z' } })],
      ['itunes.apple.com', () => json({ results: [{ collectionName: 'The Show (Clips)', feedUrl: 'https://wrong.example/feed' }, { collectionName: 'The Show', feedUrl: 'https://feeds.example/show' }] })],
      ['feeds.example/show', () => new Response(FEED)],
    ],
    async () => {
      const found = await Spotify.podcastSource(`https://open.spotify.com/episode/${ID}`)
      assert.equal(found.kind, 'episode')
      assert.equal(found.url, 'https://cdn.example/12.mp3?a=1&b=2')
      assert.equal(found.show, 'The Show')
    },
  ))

test('a show that is only on Spotify says so, and a show link gives its feed', () =>
  withFetch(
    [
      ['/embed/episode/', () => embedPage({ type: 'episode', title: 'x', subtitle: 'Exclusive Show' })],
      ['/embed/show/', () => embedPage({ type: 'episode', title: 'newest', subtitle: 'The Show' })],
      ['term=Exclusive', () => json({ results: [{ collectionName: 'Exclusive Show Fans', feedUrl: 'https://fan.example/feed' }] })],
      ['term=The%20Show', () => json({ results: [{ collectionName: 'The Show', feedUrl: 'https://feeds.example/show' }] })],
    ],
    async () => {
      await assert.rejects(Spotify.podcastSource(`https://open.spotify.com/episode/${ID}`), { code: 'spotify-only' })
      assert.deepEqual(await Spotify.podcastSource(`https://open.spotify.com/show/${ID}`), { kind: 'show', url: 'https://feeds.example/show', title: 'The Show' })
    },
  ))

// ---------- the portable app's shortcuts ----------

test('only Yoinks shortcuts into a temporary or missing folder are repaired', () => {
  // main/portable.js needs Electron; its rule is plain path logic, loaded with a stand-in.
  const Module = require('node:module')
  const realLoad = Module._load
  Module._load = function (request, ...rest) {
    if (request === 'electron') return { app: { getVersion: () => '0.0.0', getPath: () => '' }, shell: {} }
    if (request === 'original-fs') return require('node:fs')
    return realLoad.call(this, request, ...rest)
  }
  let Portable
  try {
    delete require.cache[require.resolve('../main/portable.js')]
    Portable = require('../main/portable.js')
  } finally {
    Module._load = realLoad
  }
  const tmp = path.resolve('/tmp-folder')
  const exists = () => true
  assert.equal(Portable.needsRepair(path.join(tmp, '3L7I5GsHx9', 'Yoinks.exe'), { tmp, exists }), true)
  assert.equal(Portable.needsRepair(path.resolve('/apps/Yoinks.exe'), { tmp, exists: () => false }), true, 'gone')
  assert.equal(Portable.needsRepair(path.resolve('/apps/Yoinks.exe'), { tmp, exists }), false, 'fine where it is')
  assert.equal(Portable.needsRepair(path.join(tmp, 'Other.exe'), { tmp, exists }), false, 'not ours')
  assert.equal(Portable.needsRepair('', { tmp, exists }), false)
})

// ---------- podcasts through the session ----------

test('a podcast episode defaults to audio and keeps its tags', () => {
  const choices = Ytdlp.buildChoices({ formats: [{ format_id: 'mp3', acodec: 'mp3', vcodec: 'none', abr: 128 }] })
  assert.deepEqual(choices.map(c => c.kind), ['audio'])
  const args = Ytdlp.buildArgs({ choice: choices[0], settings: { ...require('../extension/shared/settings-schema.js').defaults(), embedMetadata: false, embedThumbnail: false }, outDir: path.resolve('out'), music: true, forceTags: true })
  assert.ok(args.includes('--embed-metadata'))
  assert.ok(args.includes('--embed-thumbnail'))
  assert.ok(MEDIA) // helpers stay importable
})
