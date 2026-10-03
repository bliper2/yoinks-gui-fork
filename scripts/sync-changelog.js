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

const { render } = require('./changelog-page')

const ROOT = path.join(__dirname, '..')
const SOURCE = path.join(ROOT, 'CHANGELOG.md')
// The same file also becomes the changelog page of the GitHub Pages site.
const COPIES = [
  { file: path.join(ROOT, 'extension', 'legal', 'changelog.md'), content: source => source },
  { file: path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'raw', 'changelog.md'), content: source => source },
  { file: path.join(ROOT, 'docs', 'changelog.html'), content: render },
]

// Git may check files out with CRLF on Windows; line endings are not a difference.
const normal = text => text.replace(/\r\n/g, '\n')

const source = fs.readFileSync(SOURCE, 'utf-8')
const stale = COPIES.map(copy => ({ file: copy.file, content: copy.content(source) })).filter(copy => !fs.existsSync(copy.file) || normal(fs.readFileSync(copy.file, 'utf-8')) !== normal(copy.content))

if (process.argv.includes('--check')) {
  if (stale.length) {
    console.error(`Out of date, run "npm run sync":\n${stale.map(copy => `  ${path.relative(ROOT, copy.file)}`).join('\n')}`)
    process.exit(1)
  }
  console.log('Changelog copies are up to date.')
} else {
  for (const { file, content } of stale) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    console.log(`Wrote ${path.relative(ROOT, file)}`)
  }
  if (!stale.length) console.log('Changelog copies are up to date.')
}
