'use strict'

// Prints one CHANGELOG.md section, for the GitHub release body.
//
//   node scripts/release-notes.js 2.5.0

const fs = require('node:fs')
const path = require('node:path')
const { section } = require('./discord-announce')

const version = process.argv[2]
if (!version) {
  console.error('Usage: node scripts/release-notes.js <version>')
  process.exit(1)
}
const notes = section(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8'), version)
if (!notes) {
  console.error(`CHANGELOG.md has no section for ${version}.`)
  process.exit(1)
}
process.stdout.write(`${notes}\n`)
