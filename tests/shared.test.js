'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const Schema = require('../extension/shared/settings-schema.js')
const Template = require('../extension/shared/filename-template.js')
const Formats = require('../extension/shared/formats.js')
const Sites = require('../extension/shared/sites.js')
const Errors = require('../extension/shared/errors.js')
const Schedule = require('../extension/shared/schedule.js')

// ---------- settings ----------

test('every setting has a valid default and the defaults validate cleanly', () => {
  const defaults = Schema.defaults()
  const { settings, errors } = Schema.validate(defaults, defaults)
  assert.deepEqual(errors, {})
  assert.deepEqual(settings, defaults)
})

test('defaults are not shared between callers', () => {
  const a = Schema.defaults()
  a.siteFormats.youtube = 'audio'
  assert.deepEqual(Schema.defaults().siteFormats, {})
})

test('bad values are refused and the old value is kept', () => {
  const { settings, errors } = Schema.validate({ concurrency: 99, scheduleFrom: '25:00', folderBy: 'nope', outDir: 'relative/path', subsLang: 'english!' })
  assert.deepEqual(Object.keys(errors).sort(), ['concurrency', 'folderBy', 'outDir', 'scheduleFrom', 'subsLang'])
  assert.equal(settings.concurrency, 2)
  assert.equal(settings.scheduleFrom, '01:00')
})

test('remembered qualities accept only known sites and formats', () => {
  assert.deepEqual(Schema.validate({ siteFormats: { youtube: '720', soundcloud: 'audio' } }).errors, {})
  assert.ok(Schema.validate({ siteFormats: { youtube: '9999' } }).errors.siteFormats)
  assert.ok(Schema.validate({ siteFormats: { 'Bad Key!': 'audio' } }).errors.siteFormats)
  assert.ok(Schema.validate({ siteFormats: ['audio'] }).errors.siteFormats)
})

test('presets are checked strictly', () => {
  const good = { id: 'abc123', name: 'Music FLAC', format: 'audio', audioFormat: 'flac', embedSubs: false, embedThumbnail: true }
  const { settings, errors } = Schema.validate({ presets: [{ ...good, name: '  Music FLAC  ', evil: 1 }] })
  assert.deepEqual(errors, {})
  assert.deepEqual(settings.presets, [good], 'trimmed, unknown fields dropped')
  for (const bad of [{ ...good, id: 'BAD ID' }, { ...good, name: '' }, { ...good, name: 'x'.repeat(25) }, { ...good, format: '99' }, { ...good, audioFormat: 'wav' }, { ...good, embedSubs: 'yes' }, null]) {
    assert.ok(Schema.validate({ presets: [bad] }).errors.presets, JSON.stringify(bad))
  }
  assert.ok(Schema.validate({ presets: Array.from({ length: Schema.MAX_PRESETS + 1 }, (_, i) => ({ ...good, id: `p${i}` })) }).errors.presets, 'too many')
  assert.deepEqual(Schema.defaults().presets, [])
  const a = Schema.defaults()
  a.presets.push(good)
  assert.deepEqual(Schema.defaults().presets, [], 'defaults are not shared')
})

test('unknown keys are ignored, not stored', () => {
  assert.equal('evil' in Schema.validate({ evil: 1 }).settings, false)
})

test('desktop-only settings are flagged so the extension hides them', () => {
  for (const key of ['clipboardWatch', 'confirmClose', 'scheduleOn', 'scheduleFrom', 'scheduleTo']) assert.equal(Schema.BY_KEY[key].only, 'desktop', key)
})

// ---------- file names ----------

test('templates are validated', () => {
  assert.equal(Template.validate('{artist} - {title}'), null)
  assert.match(Template.validate('{nope}'), /unknown part/)
  assert.match(Template.validate('a/b {title}'), /cannot contain/)
  assert.match(Template.validate('100% {title}'), /cannot contain/)
  assert.match(Template.validate('no parts'), /at least one part/)
})

test('yt-dlp templates: numbering, playlist folder and folder-by', () => {
  assert.equal(Template.toYtdlp('{title}'), '%(title).120B.%(ext)s')
  assert.equal(Template.toYtdlp('{title}', { playlist: true }), '%(playlist_title,playlist|Playlist).80B/%(playlist_index)03d - %(title).120B.%(ext)s')
  assert.equal(Template.toYtdlp('{title}', { folderBy: 'uploader' }), '%(uploader,channel|Unknown).60B/%(title).120B.%(ext)s')
  assert.equal(Template.toYtdlp('{title}', { folderBy: 'site', playlist: true, numbered: false }), '%(extractor_key|Other)s/%(playlist_title,playlist|Playlist).80B/%(title).120B.%(ext)s')
  assert.equal(Template.toYtdlp('{bad}'), '%(title).120B.%(ext)s', 'a stale invalid template falls back')
})

test('the file name preview shows the folders', () => {
  assert.equal(Template.preview('{artist} - {title}', { ext: 'mp3' }).name, 'Rick Astley - Never Gonna Give You Up.mp3')
  assert.equal(Template.preview('{title}', { ext: 'mp3', folderBy: 'uploader' }).name, 'Rick Astley\\Never Gonna Give You Up.mp3')
})

// ---------- format picking ----------

test('format picking', () => {
  const choices = [{ kind: 'video', height: 1080 }, { kind: 'video', height: 720 }, { kind: 'video', height: 360 }, { kind: 'audio' }]
  assert.equal(Formats.pickChoice(choices, 'best'), 0)
  assert.equal(Formats.pickChoice(choices, '720'), 1)
  assert.equal(Formats.pickChoice(choices, '480'), 2)
  assert.equal(Formats.pickChoice(choices, '144'), 2, 'nothing that small: the smallest video')
  assert.equal(Formats.pickChoice(choices, 'audio'), 3)
  assert.equal(Formats.pickChoice([], 'best'), -1)
  assert.equal(Formats.formatOf(choices[1]), '720')
  assert.equal(Formats.formatOf(choices[3]), 'audio')
})

// ---------- sites ----------

test('which pages are videos', () => {
  const yes = [
    'https://www.youtube.com/watch?v=abc',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.instagram.com/reel/AbC/',
    'https://www.instagram.com/someone/reel/AbC/',
    'https://www.instagram.com/p/AbC/',
    'https://www.tiktok.com/@a/video/123',
    'https://x.com/a/status/1',
    'https://soundcloud.com/artist/track',
    'https://www.reddit.com/r/videos/comments/abc123/title/',
    'https://www.facebook.com/watch/?v=1',
    'https://fb.watch/abc/',
    'https://www.dailymotion.com/video/x8abc',
    'https://streamable.com/abc12',
    'https://rumble.com/v4abc-title.html',
  ]
  const no = [
    'https://www.youtube.com/',
    'https://www.youtube.com/@channel',
    'https://www.instagram.com/someone/',
    'https://www.instagram.com/explore/',
    'https://www.facebook.com/watch/',
    'https://www.facebook.com/settings',
    'https://soundcloud.com/discover',
    'https://example.com/video',
  ]
  for (const url of yes) assert.equal(Sites.isMediaPage(url), true, url)
  for (const url of no) assert.equal(Sites.isMediaPage(url), false, url)
})

test('playlists and music sites', () => {
  assert.equal(Sites.isPlaylistLink('https://www.youtube.com/playlist?list=PL1'), true)
  assert.equal(Sites.isPlaylistLink('https://www.youtube.com/watch?v=a&list=PL1'), false)
  assert.equal(Sites.hasPlaylistParam('https://www.youtube.com/watch?v=a&list=PL1'), true)
  assert.equal(Sites.isMusic('https://music.youtube.com/watch?v=a'), true)
  assert.equal(Sites.isMusic('https://www.youtube.com/watch?v=a'), false)
  assert.equal(Sites.isSpotify('https://open.spotify.com/track/' + 'a'.repeat(22)), true)
})

test('the same video with a timestamp or playlist is still the same video', () => {
  assert.equal(Sites.sameMedia('https://youtu.be/abc', 'https://www.youtube.com/watch?v=abc&t=30'), true)
  assert.equal(Sites.sameMedia('https://youtu.be/abc', 'https://youtu.be/def'), false)
})

test('"yoink all videos" keeps video links once, without tracking noise', () => {
  const links = Sites.mediaLinks([
    'https://www.youtube.com/watch?v=aaa&list=PL1&index=3',
    'https://www.youtube.com/watch?v=aaa&t=30s',
    'https://www.youtube.com/watch?v=bbb#comments',
    'https://www.youtube.com/@channel',
    'https://www.youtube.com/shorts/ccc',
    'https://example.com/watch?v=zzz',
    'javascript:void(0)',
    'not a url',
  ])
  assert.deepEqual(links, ['https://www.youtube.com/watch?v=aaa', 'https://www.youtube.com/watch?v=bbb', 'https://www.youtube.com/shorts/ccc'])
  assert.equal(Sites.mediaLinks(Array.from({ length: 400 }, (_, i) => `https://www.youtube.com/watch?v=v${i}`)).length, 300)
})

// ---------- error messages ----------

test('yt-dlp errors become plain sentences', () => {
  const code = text => Errors.friendly(text).code
  assert.equal(code('ERROR: [youtube] x: Private video. Sign in if you have been granted access'), 'private')
  assert.equal(code('ERROR: Sign in to confirm your age. This video may be inappropriate for some users.'), 'age')
  assert.equal(code('ERROR: Unable to download webpage: <urlopen error [Errno 7] getaddrinfo failed>'), 'network')
  assert.equal(code('ERROR: [Instagram] x: Instagram sent an empty media response.'), 'login')
  assert.equal(code('ERROR: [TikTok] 1: Unable to extract webpage video data; please report this issue on https://github.com/yt-dlp/yt-dlp/issues?q='), 'outdated')
  assert.equal(code('HTTP Error 403: Forbidden'), 'forbidden')
  assert.equal(Errors.friendly('ERROR: [generic] something odd happened').message, 'something odd happened')
  assert.equal(Errors.friendly('HTTP Error 429').retryable, true)
  assert.equal(Errors.friendly('This video is private').retryable, false)
})

// ---------- download window ----------

test('the download window, including one that crosses midnight', () => {
  const at = (h, m = 0) => new Date(2026, 9, 3, h, m)
  const day = { scheduleOn: true, scheduleFrom: '01:00', scheduleTo: '07:00' }
  assert.equal(Schedule.isOpen({ ...day, scheduleOn: false }, at(12)), true, 'off means always open')
  assert.equal(Schedule.isOpen(day, at(0, 59)), false)
  assert.equal(Schedule.isOpen(day, at(1, 0)), true)
  assert.equal(Schedule.isOpen(day, at(6, 59)), true)
  assert.equal(Schedule.isOpen(day, at(7, 0)), false)
  const night = { scheduleOn: true, scheduleFrom: '22:00', scheduleTo: '06:00' }
  assert.equal(Schedule.isOpen(night, at(23)), true)
  assert.equal(Schedule.isOpen(night, at(3)), true)
  assert.equal(Schedule.isOpen(night, at(12)), false)
  assert.equal(Schedule.isOpen({ scheduleOn: true, scheduleFrom: '08:00', scheduleTo: '08:00' }, at(3)), true, 'same time means always')
})

test('watched channels are validated', () => {
  const Schema = require('../extension/shared/settings-schema.js')
  const good = [{ url: 'https://www.youtube.com/@a', title: 'A', seen: ['x'] }]
  assert.deepEqual(Schema.validate({ watches: good }, Schema.defaults()).settings.watches, good)
  const bad = Schema.validate({ watches: [{ url: 'javascript:alert(1)', title: 'A', seen: [] }] }, Schema.defaults())
  assert.deepEqual(bad.settings.watches, [])
  assert.ok(bad.errors.watches)
})
