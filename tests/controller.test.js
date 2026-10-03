'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeController, MEDIA } = require('./helpers.js')

test('quick jobs respect the number of downloads at once', async () => {
  const t = makeController({ settings: { concurrency: 1 } })
  await t.controller.ready
  await t.controller.command({ type: 'batch', text: 'https://youtu.be/aaa\nhttps://youtu.be/bbb' })
  assert.equal(t.channels.length, 1, 'only the first job opens a session')
  assert.equal(t.controller.view().queue.filter(j => j.phase === 'probing').length, 1)
  assert.equal(t.controller.view().queue.filter(j => j.phase === 'queued').length, 1)
})

test('cancel right after pause removes the job instead of leaving it paused', async () => {
  const t = makeController()
  await t.controller.ready
  await t.controller.command({ type: 'batch', text: 'https://youtu.be/aaa' })
  t.send(t.lastChannel(), MEDIA())
  const id = t.controller.view().queue[0].id
  assert.equal(t.controller.view().queue[0].phase, 'downloading')
  await t.controller.command({ type: 'pause', id })
  await t.controller.command({ type: 'cancel', id })
  t.send(t.lastChannel(), { type: 'paused' }) // the session answers the first abort
  assert.equal(t.controller.view().queue.length, 0)
})

test('links keep their punctuation out', async () => {
  const t = makeController()
  const { urlsFrom } = t.controller
  assert.deepEqual(urlsFrom('see https://youtu.be/abc, or (https://youtu.be/def).'), ['https://youtu.be/abc', 'https://youtu.be/def'])
  assert.deepEqual(urlsFrom('https://en.wikipedia.org/wiki/Song_(music) and https://x.com/a/status/1.'), ['https://en.wikipedia.org/wiki/Song_(music)', 'https://x.com/a/status/1'])
  assert.deepEqual(urlsFrom('"https://vm.tiktok.com/ZM1/" https://www.instagram.com/reel/AbC/?igsh=Mx=='), ['https://vm.tiktok.com/ZM1/', 'https://www.instagram.com/reel/AbC/?igsh=Mx=='])
  assert.deepEqual(urlsFrom('no links here'), [])
})

test('a text search shows results and picking one replaces the card', async () => {
  const t = makeController()
  await t.controller.ready
  await t.controller.command({ type: 'search', query: '  lofi   beats ' })
  assert.deepEqual(t.lastChannel().posts, [{ type: 'search', query: 'lofi beats' }])
  assert.equal(t.controller.view().lookup.phase, 'probing')
  t.send(t.lastChannel(), { type: 'results', query: 'lofi beats', results: [{ title: 'One', url: 'https://www.youtube.com/watch?v=1' }] })
  const lookup = t.controller.view().lookup
  assert.equal(lookup.phase, 'results')
  assert.equal(lookup.results.length, 1)
  await t.controller.command({ type: 'lookup', url: 'https://www.youtube.com/watch?v=1' })
  assert.equal(t.controller.view().lookup.url, 'https://www.youtube.com/watch?v=1')
  assert.equal(t.controller.view().lookup.kind, undefined, 'the search card is gone')
  await t.controller.command({ type: 'search', query: '   ' })
  assert.match(t.controller.view().toasts.at(-1).text, /search/i)
})

test('a failed search can be retried as a search', async () => {
  const t = makeController()
  await t.controller.ready
  await t.controller.command({ type: 'search', query: 'abc' })
  const first = t.lastChannel()
  t.send(first, { type: 'error', code: 'network', message: 'offline', retryable: true })
  assert.equal(t.controller.view().lookup.phase, 'lookup-error')
  await t.controller.command({ type: 'retry', id: t.controller.view().lookup.id })
  assert.deepEqual(t.lastChannel().posts, [{ type: 'search', query: 'abc' }])
})

test('chosen playlist videos are sent with the download', async () => {
  const t = makeController()
  await t.controller.ready
  await t.controller.command({ type: 'lookup', url: 'https://www.youtube.com/playlist?list=PL1', playlist: true })
  t.send(t.lastChannel(), MEDIA({ playlistCount: 3, entries: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] }))
  assert.equal(t.controller.view().lookup.phase, 'choices')
  await t.controller.command({ type: 'choose', index: 0, items: [1, 3] })
  assert.deepEqual(t.lastChannel().posts.at(-1), { type: 'download', index: 0, clip: null, items: [1, 3], overrides: null })
})

test('"always use the default format" still lets you pick videos from a playlist', async () => {
  const t = makeController({ settings: { alwaysUseFormat: true } })
  await t.controller.ready
  await t.controller.command({ type: 'lookup', url: 'https://www.youtube.com/playlist?list=PL1', playlist: true })
  t.send(t.lastChannel(), MEDIA({ playlistCount: 2, entries: [{ title: 'a' }, { title: 'b' }] }))
  assert.equal(t.controller.view().lookup.phase, 'choices')
  await t.controller.command({ type: 'closeLookup' })
  await t.controller.command({ type: 'lookup', url: 'https://www.youtube.com/watch?v=1' })
  t.send(t.lastChannel(), MEDIA())
  assert.equal(t.controller.view().lookup, null, 'a single video is added at once')
})

test('a remembered quality for a website is used without asking', async () => {
  const t = makeController({ settings: { concurrency: 5 } })
  await t.controller.ready
  await t.controller.command({ type: 'lookup', url: 'https://www.youtube.com/watch?v=1' })
  t.send(t.lastChannel(), MEDIA())
  await t.controller.command({ type: 'choose', index: 1, rememberSite: true })
  assert.deepEqual(t.settings().siteFormats, { youtube: '720' })
  // next lookup on the same site skips the list and picks 720p
  await t.controller.command({ type: 'lookup', url: 'https://www.youtube.com/watch?v=2' })
  t.send(t.lastChannel(), MEDIA())
  assert.equal(t.controller.view().lookup, null)
  const job = t.controller.view().queue.find(j => j.url.endsWith('=2'))
  assert.equal(job.choiceLabel, '720p')
  // quick buttons and batch use it too
  await t.controller.command({ type: 'batch', text: 'https://www.youtube.com/watch?v=3' })
  t.send(t.lastChannel(), MEDIA())
  assert.equal(t.controller.view().queue.find(j => j.url.endsWith('=3')).choiceLabel, '720p')
  await t.controller.command({ type: 'siteformat:forget', site: 'youtube' })
  assert.deepEqual(t.settings().siteFormats, {})
})

test('downloads wait outside the set times on the desktop app only', async () => {
  const hour = new Date().getHours()
  const at = h => `${String((h + 24) % 24).padStart(2, '0')}:00`
  const closed = { scheduleOn: true, scheduleFrom: at(hour + 2), scheduleTo: at(hour + 4) }

  const desktop = makeController({ platform: 'desktop', settings: closed })
  await desktop.controller.ready
  await desktop.controller.command({ type: 'batch', text: 'https://youtu.be/aaa' })
  assert.equal(desktop.channels.length, 0, 'nothing starts')
  const job = desktop.controller.view().queue[0]
  assert.equal(job.phase, 'queued')
  assert.match(job.waitNote, /Waiting for/)

  const extension = makeController({ platform: 'extension', settings: closed })
  await extension.controller.ready
  await extension.controller.command({ type: 'batch', text: 'https://youtu.be/aaa' })
  assert.equal(extension.channels.length, 1, 'the extension ignores the schedule')

  const open = makeController({ platform: 'desktop', settings: { scheduleOn: true, scheduleFrom: at(hour - 1), scheduleTo: at(hour + 1) } })
  await open.controller.ready
  await open.controller.command({ type: 'batch', text: 'https://youtu.be/aaa' })
  assert.equal(open.channels.length, 1, 'inside the window it starts')
  await desktop.controller.command({ type: 'cancel', id: job.id }) // stop its timer
})

test('converting a file starts a convert session and ends up in history', async () => {
  const t = makeController({ platform: 'desktop' })
  await t.controller.ready
  await t.controller.command({ type: 'convert', paths: ['C:\\Videos\\clip.mkv'], target: 'mp3' })
  assert.deepEqual(t.lastChannel().posts, [{ type: 'convert', filepath: 'C:\\Videos\\clip.mkv', target: 'mp3' }])
  const job = t.controller.view().queue[0]
  assert.equal(job.title, 'clip.mkv')
  assert.equal(job.choiceLabel, 'to MP3')
  t.send(t.lastChannel(), { type: 'progress', progress: { downloadedBytes: 1, totalBytes: 2 } })
  t.send(t.lastChannel(), { type: 'done', filepath: 'C:\\Music\\clip.mp3', folder: null })
  const view = t.controller.view()
  assert.equal(view.queue.length, 0)
  assert.equal(view.history[0].filepath, 'C:\\Music\\clip.mp3')
  assert.equal(view.history[0].url, '')
  assert.equal(view.history[0].kind, 'audio')
})

test('the file picker feeds the converter', async () => {
  const t = makeController({ platform: 'desktop', reply: { 'files:pick': async () => ({ type: 'files', paths: ['C:\\a.wav', 'C:\\b.flac'] }) } })
  await t.controller.ready
  await t.controller.command({ type: 'convert:pick', target: 'opus' })
  assert.equal(t.channels.length, 2)
  assert.equal(t.channels[1].posts[0].target, 'opus')
})

test('health check results show up in the view', async () => {
  const report = { type: 'health', status: 'warn', checks: [{ id: 'x', label: 'X', status: 'warn', detail: 'hmm' }], at: 1 }
  const t = makeController({ reply: { health: async () => report } })
  await t.controller.ready
  assert.equal(t.controller.view().health.report, null)
  await t.controller.command({ type: 'health:run' })
  assert.deepEqual(t.controller.view().health, { busy: false, report })
})

test('a page can hand links to the batch view', async () => {
  const t = makeController()
  await t.controller.ready
  await t.controller.command({ type: 'prefill', text: 'https://a.com/1\nhttps://a.com/2' })
  assert.match(t.controller.view().prefill, /a\.com\/2/)
  await t.controller.command({ type: 'prefill:clear' })
  assert.equal(t.controller.view().prefill, null)
})

test('retryable failures are retried, then given up on', async () => {
  const t = makeController({ settings: { retries: 1 } })
  await t.controller.ready
  await t.controller.command({ type: 'batch', text: 'https://youtu.be/aaa' })
  t.send(t.lastChannel(), { type: 'error', code: 'network', message: 'offline', retryable: true })
  assert.equal(t.controller.view().queue[0].phase, 'queued')
  assert.match(t.controller.view().queue[0].status, /Retrying \(1\/1\)/)
  await t.controller.command({ type: 'cancel', id: t.controller.view().queue[0].id })
  assert.equal(t.controller.view().queue.length, 0)
})

test('a preset picks the quality and carries its extras to the download', async () => {
  const preset = { id: 'flac1', name: 'Music FLAC', format: 'audio', audioFormat: 'flac', embedSubs: false, embedThumbnail: true }
  const t = makeController({ settings: { presets: [preset] } })
  await t.controller.ready
  await t.controller.command({ type: 'batch', text: 'https://youtu.be/aaa', format: 'default', preset: 'flac1' })
  t.send(t.lastChannel(), MEDIA())
  assert.deepEqual(t.lastChannel().posts.at(-1), { type: 'download', index: 2, clip: null, items: null, overrides: { audioFormat: 'flac', embedSubs: false, embedThumbnail: true } })
  // an unknown preset id is ignored: the normal default is used
  await t.controller.command({ type: 'quick', url: 'https://youtu.be/bbb', format: 'best', preset: 'nope' })
  t.send(t.lastChannel(), MEDIA())
  assert.equal(t.lastChannel().posts.at(-1).overrides, null)
})

test('picking from the lookup card can apply a preset', async () => {
  const t = makeController()
  await t.controller.ready
  await t.controller.command({ type: 'lookup', url: 'https://www.youtube.com/watch?v=1' })
  t.send(t.lastChannel(), MEDIA())
  await t.controller.command({ type: 'choose', index: 1, overrides: { audioFormat: 'opus', embedSubs: true, embedThumbnail: false, evil: 'x' } })
  assert.deepEqual(t.lastChannel().posts.at(-1).overrides, { audioFormat: 'opus', embedSubs: true, embedThumbnail: false })
})
