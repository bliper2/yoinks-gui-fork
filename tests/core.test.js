'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { Session, validItems, validOverrides } = require('../core/session.js')
const Health = require('../core/health.js')
const Match = require('../core/match.js')
const Spotify = require('../core/spotify.js')
const Ytdlp = require('../main/ytdlp.js')
const Schema = require('../extension/shared/settings-schema.js')

const ROOT = path.join(__dirname, '..')

// ---------- yt-dlp arguments ----------

const settings = (over = {}) => ({ ...Schema.defaults(), ...over })
const argsFor = (over, params = {}) => Ytdlp.buildArgs({ choice: { kind: 'video', height: 720 }, settings: settings(over), outDir: path.join(ROOT, 'out'), ...params })

test('a video download asks for the chosen height and writes into the folder', () => {
  const args = argsFor()
  assert.ok(args.includes('bv*[height<=720]+ba/b[height<=720]/b'))
  assert.ok(args.at(-1).startsWith(path.join(ROOT, 'out')))
})

test('chosen playlist videos become --playlist-items, only for playlists', () => {
  const withItems = argsFor({}, { playlist: true, items: [1, 3, 5] })
  assert.equal(withItems[withItems.indexOf('--playlist-items') + 1], '1,3,5')
  assert.equal(argsFor({}, { playlist: false, items: [1, 3] }).includes('--playlist-items'), false)
  assert.equal(argsFor({}, { playlist: true, items: null }).includes('--playlist-items'), false)
})

test('splitting chapters adds a chapter output template, but not for clips', () => {
  const split = argsFor({ splitChapters: true })
  assert.ok(split.includes('--split-chapters'))
  assert.ok(split.some(a => a.startsWith('chapter:') && a.includes('%(section_number)03d')))
  assert.equal(argsFor({ splitChapters: true }, { clip: { start: 1, end: 5 } }).includes('--split-chapters'), false)
  assert.equal(argsFor({ splitChapters: false }).includes('--split-chapters'), false)
})

test('sorting into folders by uploader or website', () => {
  assert.ok(argsFor({ folderBy: 'uploader' }).at(-1).includes('%(uploader,channel|Unknown).60B'))
  assert.ok(argsFor({ folderBy: 'site' }).at(-1).includes('%(extractor_key|Other)s'))
  assert.equal(argsFor({ folderBy: 'none' }).at(-1).includes('%(uploader'), false)
})

test('the link is never part of the options', () => {
  assert.equal(argsFor().some(arg => arg.startsWith('http')), false)
})

// ---------- format lists ----------

test('each quality shows the size of the file that is downloaded', () => {
  const info = {
    formats: [
      { vcodec: 'avc1', acodec: 'none', height: 720, filesize: 50_000_000, ext: 'mp4' },
      { vcodec: 'vp9', acodec: 'none', height: 720, filesize: 70_000_000, ext: 'webm' },
      { vcodec: 'avc1', acodec: 'none', height: 360, filesize: 10_000_000, ext: 'mp4' },
      { vcodec: 'none', acodec: 'opus', abr: 128, filesize: 4_000_000 },
    ],
  }
  const choices = Ytdlp.buildChoices(info)
  assert.deepEqual(choices.map(c => c.label), ['720p', '360p', 'Audio only'])
  assert.notEqual(choices[0].sizeLabel, choices[1].sizeLabel)
  assert.equal(choices[2].sizeLabel, '3.8MB')
})

// ---------- session ----------

test('picked playlist items are cleaned up', () => {
  assert.deepEqual(validItems([3, 1, 1, 99, 'x', 0], 5), [1, 3])
  assert.equal(validItems([1, 2, 3], 3), null, 'everything picked means "all"')
  assert.equal(validItems(undefined, 3), null)
  assert.throws(() => validItems([], 3), { code: 'bad-request' })
  assert.throws(() => validItems('1,2', 3), { code: 'bad-request' })
})

test('a preset can only change a few safe settings for one download', () => {
  assert.deepEqual(validOverrides({ audioFormat: 'flac', embedSubs: true, embedThumbnail: false }), { audioFormat: 'flac', embedSubs: true, embedThumbnail: false })
  assert.deepEqual(validOverrides({ audioFormat: 'exe', embedSubs: 'yes', outDir: 'C:\Windows', cookiesFromBrowser: 'chrome', ytdlpAutoUpdate: false }), {})
  assert.deepEqual(validOverrides(null), {})
  assert.deepEqual(validOverrides('x'), {})
})

test('an out-of-date yt-dlp is updated once and the step retried', async () => {
  const sent = []
  const session = new Session(m => sent.push(m))
  const realVersion = Ytdlp.versionInfo
  const realUpdate = Ytdlp.updateNow
  let version = '2025.11.12'
  let updates = 0
  Ytdlp.versionInfo = async () => ({ version, managed: true })
  Ytdlp.updateNow = async () => {
    updates++
    version = '2026.08.19'
    return { version }
  }
  const failing = code => () => Promise.reject(Object.assign(new Error('x'), { code }))
  try {
    let tries = 0
    const result = await session.retryWithUpdate({ ytdlpAutoUpdate: true }, async () => {
      if (++tries === 1) throw Object.assign(new Error('x'), { code: 'outdated' })
      return 'ok'
    })
    assert.equal(result, 'ok')
    assert.equal(updates, 1)
    assert.ok(sent.some(m => m.type === 'status' && /Updating yt-dlp/.test(m.message)))

    // again right away: throttled, the error comes through
    await assert.rejects(session.retryWithUpdate({ ytdlpAutoUpdate: true }, failing('outdated')), { code: 'outdated' })
    assert.equal(updates, 1)
    // not for other errors, and not when auto-update is off
    await assert.rejects(session.retryWithUpdate({ ytdlpAutoUpdate: true }, failing('private')), { code: 'private' })
    await assert.rejects(session.retryWithUpdate({ ytdlpAutoUpdate: false }, failing('outdated')), { code: 'outdated' })
  } finally {
    Ytdlp.versionInfo = realVersion
    Ytdlp.updateNow = realUpdate
  }
})

test('the session refuses bad requests with friendly errors', async () => {
  const replies = []
  const session = new Session(m => replies.push(m))
  await session.handle({ type: 'probe', url: 'file:///etc/passwd' })
  await session.handle({ type: 'convert', filepath: 'relative.mp4', target: 'mp3' })
  await session.handle({ type: 'nonsense' })
  await session.handle({ type: 'search', query: '   ' })
  assert.deepEqual(replies.map(r => r.type), ['error', 'error', 'error', 'error'])
  assert.deepEqual(replies.map(r => r.code), ['bad-link', 'missing', 'bad-request', 'bad-request'])
})

test('converting only touches real media files and known formats', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoinks-test-'))
  try {
    const text = path.join(dir, 'notes.txt')
    fs.writeFileSync(text, 'hi')
    const replies = []
    const session = new Session(m => replies.push(m))
    await session.handle({ type: 'convert', filepath: text, target: 'mp3' })
    await session.handle({ type: 'convert', filepath: dir, target: 'mp3' })
    assert.deepEqual(replies.map(r => r.code), ['not-media', 'missing'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- health check ----------

test('how old a yt-dlp version is', () => {
  const day = Date.UTC(2026, 9, 3)
  assert.equal(Health.ageInDays('2026.09.03', day), 30)
  assert.equal(Health.ageInDays('2026.10.03', day), 0)
  assert.equal(Health.ageInDays('nightly', day), null)
})

// ---------- Spotify ----------

test('Spotify links', () => {
  assert.deepEqual(Spotify.parseUrl('https://open.spotify.com/track/' + 'a'.repeat(22)), { type: 'track', id: 'a'.repeat(22) })
  assert.equal(Spotify.parseUrl('https://open.spotify.com/intl-de/album/' + 'B'.repeat(22)).type, 'album')
  assert.equal(Spotify.parseUrl('http://open.spotify.com/track/' + 'a'.repeat(22)), null, 'https only')
  assert.equal(Spotify.parseUrl('https://evil.example/track/' + 'a'.repeat(22)), null)
})

test('the right song ranks first', () => {
  const track = { title: 'Never Gonna Give You Up', artists: ['Rick Astley'], durationMs: 213_573 }
  const right = { url: 'u1', title: 'Never Gonna Give You Up', artist: 'Rick Astley', album: null, duration: 214 }
  const live = { url: 'u2', title: 'Never Gonna Give You Up (Live)', artist: 'Rick Astley', album: null, duration: 250 }
  const other = { url: 'u3', title: 'Together Forever', artist: 'Rick Astley', album: null, duration: 206 }
  const ranked = Match.rank(track, [other, live, right])
  assert.equal(ranked[0].url, 'u1')
  assert.ok(ranked[0].confidence >= 80)
  assert.ok(ranked.find(c => c.url === 'u2').confidence < ranked[0].confidence)
})

// ---------- repository hygiene ----------

test('the changelog copies the apps show are in sync', () => {
  const source = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf-8')
  for (const copy of ['extension/legal/changelog.md', 'android/app/src/main/res/raw/changelog.md']) {
    assert.equal(fs.readFileSync(path.join(ROOT, copy), 'utf-8'), source, `${copy} is stale: run "npm run sync"`)
  }
})

test('the app version is the same everywhere', () => {
  const pkg = require('../package.json').version
  const manifest = require('../extension/manifest.json').version
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf-8')
  assert.equal(manifest, pkg, 'extension manifest version')
  assert.equal(/versionName = "([^"]+)"/.exec(gradle)[1], pkg, 'Android versionName')
  assert.match(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf-8'), new RegExp(`^## ${pkg.replace(/\./g, '\\.')}$`, 'm'), 'CHANGELOG.md has a section for this version')
})

test('the extension manifest lists every script the background page needs', () => {
  const manifest = require('../extension/manifest.json')
  const scripts = manifest.background.scripts
  const background = fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf-8')
  const imported = /importScripts\(([^)]*)\)/.exec(background)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1))
  assert.deepEqual(scripts.slice(0, -1), imported, 'Firefox scripts and Chrome importScripts must match')
  assert.equal(scripts.at(-1), 'background.js')
  for (const file of [...scripts, ...manifest.content_scripts[0].js]) assert.ok(fs.existsSync(path.join(ROOT, 'extension', file)), file)
})
