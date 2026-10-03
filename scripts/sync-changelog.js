'use strict'

// CHANGELOG.md is the one source. The apps show it in "What's new", so a copy
// goes where each app reads it: the desktop/extension legal folder and the
// Android raw resources. Run by "npm run sync" (and before every build);
// tests/changelog.test.js fails when a copy is stale.
//
//   node scripts/sync-changelog.js          write the copies
//   node scripts/sync-changelog.js --check  exit 1 if a copy is out of date

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const SOURCE = path.join(ROOT, 'CHANGELOG.md')
const COPIES = [path.join(ROOT, 'extension', 'legal', 'changelog.md'), path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'raw', 'changelog.md')]

const source = fs.readFileSync(SOURCE, 'utf-8')
const stale = COPIES.filter(file => !fs.existsSync(file) || fs.readFileSync(file, 'utf-8') !== source)

if (process.argv.includes('--check')) {
  if (stale.length) {
    console.error(`Out of date, run "npm run sync":\n${stale.map(file => `  ${path.relative(ROOT, file)}`).join('\n')}`)
    process.exit(1)
  }
  console.log('Changelog copies are up to date.')
} else {
  for (const file of stale) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, source)
    console.log(`Wrote ${path.relative(ROOT, file)}`)
  }
  if (!stale.length) console.log('Changelog copies are up to date.')
}
