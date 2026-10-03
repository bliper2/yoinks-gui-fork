'use strict'

// Posts a version's changelog to a Discord channel through a webhook, in the
// plain style the community channel uses: starts with @everyone @here, no
// emoji, under Discord's 2000 character limit, no link previews.
//
//   DISCORD_WEBHOOK_URL=… node scripts/discord-announce.js [version] [--dry-run]
//
// The webhook is a secret: it comes from the environment (a GitHub Actions
// secret in CI) and is never stored in the repository.

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const REPO = 'bliper2/yoinks-gui-fork'
const LIMIT = 2000

/** The bullet list of one version from CHANGELOG.md (without its heading). */
function section(markdown, version) {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex(line => line.trim() === `## ${version}`)
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => line.startsWith('## '))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim() || null
}

/** The announcement text for `version`, or throws if there is no changelog for it. */
function message(version, markdown) {
  const notes = section(markdown, version)
  if (!notes) throw new Error(`CHANGELOG.md has no section for ${version}.`)
  const text = [
    '@everyone @here',
    '',
    `# Yoinks ${version} is out`,
    '',
    "**What's new**",
    notes,
    '',
    '**Download**',
    `https://github.com/${REPO}/releases/latest`,
    '',
    '**Full changelog**',
    `https://github.com/${REPO}/blob/main/CHANGELOG.md`,
  ].join('\n')
  if (text.length > LIMIT) throw new Error(`The announcement is ${text.length} characters; Discord allows ${LIMIT}. Shorten the ${version} changelog.`)
  return text
}

async function post(webhook, text) {
  const response = await fetch(`${webhook}?wait=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': `Yoinks-announce (github.com/${REPO}, 1.0)` },
    // parse: ['everyone'] lets the @everyone @here pings notify; flags 4 hides link previews.
    body: JSON.stringify({ content: text, username: 'Yoinks', allowed_mentions: { parse: ['everyone'] }, flags: 4 }),
  })
  if (!response.ok) throw new Error(`Discord answered ${response.status}: ${await response.text()}`)
  return response.json()
}

async function main() {
  const args = process.argv.slice(2)
  const version = args.find(arg => !arg.startsWith('--')) ?? require('../package.json').version
  const text = message(version, fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf-8'))
  if (args.includes('--dry-run')) {
    console.log(text)
    console.log(`\n(${text.length} characters, not sent)`)
    return
  }
  const webhook = process.env.DISCORD_WEBHOOK_URL
  if (!/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(webhook ?? '')) throw new Error('Set DISCORD_WEBHOOK_URL to a Discord webhook link.')
  const sent = await post(webhook, text)
  console.log(`Posted to Discord (message ${sent.id}, everyone-ping ${sent.mention_everyone}).`)
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message)
    process.exit(1)
  })
}

module.exports = { section, message }
