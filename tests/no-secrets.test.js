'use strict'

// A Discord webhook link lets anyone post to the community channel. It lives
// only in the DISCORD_WEBHOOK_URL environment variable or a GitHub Actions
// secret. This fails if a webhook link ever ends up in a project file.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const SKIP = new Set(['node_modules', '.git', 'release', 'build', '.gradle', '.idea', 'promo'])
const WEBHOOK = /discord(?:app)?\.com\/api\/webhooks\/\d{15,}\/[\w-]{20,}/

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* files(full)
    else if (fs.statSync(full).size < 5_000_000) yield full
  }
}

test('no Discord webhook link is stored in the project files', () => {
  const found = []
  for (const file of files(ROOT)) {
    let content
    try {
      content = fs.readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    if (WEBHOOK.test(content)) found.push(path.relative(ROOT, file))
  }
  assert.deepEqual(found, [], `Remove the webhook link from: ${found.join(', ')} and create a new webhook, the old one is exposed.`)
})
