'use strict'

// 3.0.0: the queue across restarts, "Download again", SponsorBlock, the
// proxy, more cookie browsers, the checked yt-dlp download and the tray summary.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { makeController, MEDIA } = require('./helpers.js')
const Schema = require('../extension/shared/settings-schema.js')
const Errors = require('../extension/shared/errors.js')
const Controller = require('../extension/shared/controller.js')
const Ytdlp = require('../main/ytdlp.js')

const settings = (over = {}) => ({ ...Schema.defaults(), ...over })
const argsFor = (over, params = {}) => Ytdlp.buildArgs({ choice: { kind: 'video', height: 720 }, settings: settings(over), outDir: path.resolve('out'), ...params })

// ---------- queue across restarts ----------

test('unfinished jobs are saved, and the lookup card is not', async () => {
  const t = makeController()
  await t.controller.ready
  await t.controller.command({ type: 'quick', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', format: 'audio' })
  await t.controller.command({ type: 'lookup', url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' })
  await t.tick()
  assert.equal(t.saved.queue.length, 1)
  assert.equal(t.saved.queue[0].url, 'https://www.youtube.com/watch?v=aaaaaaaaaaa')
  assert.equal(t.saved.queue[0].wantFormat, 'audio')
})

test('saved jobs come back paused, failed ones failed, and resume looks them up again', async () => {
  const stored = {
    queue: [
      { url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', createdAt: 1, wantFormat: '720', title: 'One', failed: false },
      { url: 'https://www.youtube.com/watch?v=ccccccccccc', createdAt: 2, title: 'Two', failed: true, error: { code: 'network', message: 'Network problem.' } },
      { url: '', createdAt: 3 },
      null,
    ],
  }
  const t = makeController({ stored })
  await t.controller.ready
  const [one, two] = t.controller.view().queue
  assert.equal(t.controller.view().queue.length, 2)
  assert.equal(one.phase, 'paused')
  assert.equal(one.note, 'Paused when Yoinks closed')
  assert.equal(two.phase, 'failed')
  assert.equal(two.error.message, 'Network problem.')
  assert.equal(t.channels.length, 0, 'nothing starts by itself')

  await t.controller.command({ type: 'resume', id: one.id })
  assert.deepEqual(t.lastChannel().posts[0], { type: 'probe', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', playlist: false })
  t.send(t.lastChannel(), MEDIA())
  // The restored job keeps the quality it was added with.
  assert.equal(t.lastChannel().posts[1].index, 1)
})

// ---------- download again ----------

test('"Download again" repeats the format of a finished download', async () => {
  const t = makeController()
  await t.controller.ready
  await t.controller.command({ type: 'quick', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', format: 'audio' })
  const channel = t.lastChannel()
  t.send(channel, MEDIA())
  t.send(channel, { type: 'done', filepath: '/music/A video.mp3', folder: null })
  const entry = t.controller.view().history[0]
  assert.equal(entry.again.format, 'audio')

  await t.controller.command({ type: 'history:again', entryId: entry.id })
  const job = t.controller.view().queue[0]
  assert.equal(job.wantFormat, 'audio')
  assert.equal(job.url, 'https://www.youtube.com/watch?v=aaaaaaaaaaa')
})

test('"Download again" on an old entry without a format uses the default', async () => {
  const stored = { history: [{ id: 'done-1', title: 'Old', url: 'https://soundcloud.com/a/b', filepath: '/a.mp3', at: 1 }] }
  const t = makeController({ stored })
  await t.controller.ready
  await t.controller.command({ type: 'history:again', entryId: 'done-1' })
  assert.equal(t.controller.view().queue[0].wantFormat, 'audio') // music site
})

// ---------- settings ----------

test('proxy: empty or scheme://host:port, nothing else', () => {
  const ok = ['', 'socks5://127.0.0.1:1080', 'http://proxy.example.com:8080', 'socks5h://user:pa55@host:1080', 'https://h:443/']
  const bad = ['127.0.0.1:1080', 'ftp://h:21', 'http://h', 'http://h:80/path', 'http://h :80', '--exec=x']
  for (const value of ok) assert.deepEqual(Schema.validate({ proxy: value }).errors, {}, value)
  for (const value of bad) assert.ok(Schema.validate({ proxy: value }).errors.proxy, value)
  assert.equal(Schema.proxyLabel('socks5://user:secret@host:1080'), 'socks5://***@host:1080')
})

test('the proxy and the cookie browsers reach every online yt-dlp call', () => {
  const args = argsFor({ proxy: 'socks5://127.0.0.1:1080', cookiesFromBrowser: 'vivaldi' })
  assert.equal(args[args.indexOf('--proxy') + 1], 'socks5://127.0.0.1:1080')
  assert.equal(args[args.indexOf('--cookies-from-browser') + 1], 'vivaldi')
  assert.equal(argsFor().includes('--proxy'), false)
  for (const browser of ['chromium', 'vivaldi', 'opera', 'whale']) assert.deepEqual(Schema.validate({ cookiesFromBrowser: browser }).errors, {})
})

test('SponsorBlock removes the chosen categories, but never from clips', () => {
  const sponsors = argsFor({ sponsorBlock: 'sponsor' })
  assert.equal(sponsors[sponsors.indexOf('--sponsorblock-remove') + 1], 'sponsor')
  const most = argsFor({ sponsorBlock: 'most' })
  assert.equal(most[most.indexOf('--sponsorblock-remove') + 1], 'sponsor,selfpromo,interaction,intro,outro')
  assert.equal(argsFor({ sponsorBlock: 'off' }).includes('--sponsorblock-remove'), false)
  assert.equal(argsFor({ sponsorBlock: 'most' }, { clip: { start: 0, end: 10 } }).includes('--sponsorblock-remove'), false)
})

test('proxy failures get their own message', () => {
  assert.equal(Errors.friendly('ERROR: Unable to download webpage: Unable to connect to proxy').code, 'proxy')
})

// ---------- checked yt-dlp download ----------

test('the checksum for our yt-dlp file is read from SHA2-256SUMS', () => {
  const hash = 'a'.repeat(64)
  const sums = `${'b'.repeat(64)}  yt-dlp_linux\n${hash}  yt-dlp.exe\r\n${'c'.repeat(64)}  yt-dlp.exe.zip\n`
  assert.equal(Ytdlp.checksumFor(sums, 'yt-dlp.exe'), hash)
  assert.equal(Ytdlp.checksumFor(sums, 'yt-dlp_macos'), null)
  assert.equal(Ytdlp.checksumFor('garbage', 'yt-dlp.exe'), null)
})

// ---------- taskbar and tray ----------

test('job percent is shared by the badge and the taskbar', () => {
  assert.equal(Controller.percentOf({ progress: { downloadedBytes: 50, totalBytes: 100 } }), 50)
  assert.equal(Controller.percentOf({ progress: { downloadedBytes: 50 } }), null)
  assert.equal(Controller.percentOf({ processing: true }), 99)
  assert.equal(Controller.percentOf({ item: { index: 2, count: 4 }, progress: { downloadedBytes: 1, totalBytes: 2 } }), 37)
})

test('the tray and taskbar summary of the queue', () => {
  // In plain Node require('electron') is only a path, so tray.js loads without a window.
  const Tray = require('../main/tray.js')
  const queue = [
    { phase: 'downloading', progress: { downloadedBytes: 1, totalBytes: 4 } },
    { phase: 'downloading', progress: { downloadedBytes: 3, totalBytes: 4 } },
    { phase: 'queued' },
    { phase: 'paused' },
  ]
  const summary = Tray.summarize(queue)
  assert.deepEqual(summary, { fraction: 0.5, active: 2, waiting: 1 })
  assert.equal(Tray.tooltipOf(summary), 'Yoinks: 2 downloading, 50%, 1 waiting')
  assert.equal(Tray.summarize([{ phase: 'downloading', progress: { downloadedBytes: 1 } }]).fraction, null)
  assert.equal(Tray.tooltipOf(Tray.summarize([])), 'Yoinks')
})
