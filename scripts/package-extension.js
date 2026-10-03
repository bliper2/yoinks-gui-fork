'use strict'

// Builds the two extension downloads for a release into release/:
//   Yoinks-extension-<version>.zip   Brave / Chrome / Edge, with the helper
//                                    (for people who set it up with Node.js)
//   Yoinks-extension-<version>.xpi   Firefox 140+ / Waterfox (just the extension)
//
//   node scripts/package-extension.js

const fs = require('node:fs')
const path = require('node:path')
const AdmZip = require('adm-zip')

const ROOT = path.join(__dirname, '..')
const { version } = require('../package.json')
const OUT = path.join(ROOT, 'release')
fs.mkdirSync(OUT, { recursive: true })

/** Add a folder's files under `prefix` (never the machine-specific host manifests). */
function addFolder(zip, folder, prefix) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name)
    if (entry.isDirectory()) addFolder(zip, full, `${prefix}${entry.name}/`)
    else if (!entry.name.startsWith('com.yoinks.host')) zip.addLocalFile(full, prefix.replace(/\/$/, ''))
  }
}

// Firefox / Waterfox: the extension folder is the add-on.
const xpi = new AdmZip()
addFolder(xpi, path.join(ROOT, 'extension'), '')
xpi.writeZip(path.join(OUT, `Yoinks-extension-${version}.xpi`))

// Brave / Chrome / Edge: extension + helper + what the helper needs.
const root = `Yoinks-extension-${version}/`
const zip = new AdmZip()
for (const folder of ['extension', 'host', 'core']) addFolder(zip, path.join(ROOT, folder), `${root}${folder}/`)
zip.addLocalFile(path.join(ROOT, 'main', 'ytdlp.js'), `${root}main`)
for (const file of ['package.json', 'package-lock.json', 'README.md', 'ffmpeg.exe', 'ffprobe.exe']) {
  const full = path.join(ROOT, file)
  if (fs.existsSync(full)) zip.addLocalFile(full, root.replace(/\/$/, ''))
  else console.warn(`Skipped ${file} (not found)`)
}
zip.writeZip(path.join(OUT, `Yoinks-extension-${version}.zip`))

console.log(`Wrote release/Yoinks-extension-${version}.xpi and .zip`)
