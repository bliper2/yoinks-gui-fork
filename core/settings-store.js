'use strict'

// The single reader/writer of settings.json. The desktop app and the native
// helper both go through here; every write is validated by the shared schema.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const Schema = require('../extension/shared/settings-schema.js')

const APP_DATA = process.env.APPDATA ?? path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Application Support' : '.config')
const SETTINGS_PATH = path.join(APP_DATA, 'yoinks-gui', 'settings.json')
const DEFAULT_OUT_DIR = path.join(os.homedir(), 'Downloads')

function load() {
  let stored = {}
  try {
    stored = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`settings.json unreadable, using defaults: ${err.message}`)
  }
  return Schema.sanitize(stored)
}

// Write to a temp file then rename, so a crash never leaves half a file.
function write(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  const tmp = `${SETTINGS_PATH}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2))
  fs.renameSync(tmp, SETTINGS_PATH)
}

/** Apply a partial change. Returns { settings, errors }; nothing invalid is saved. */
function update(patch) {
  const { settings, errors } = Schema.validate(patch, load())
  write(settings)
  return { settings, errors }
}

function reset() {
  // Keep the terms acceptance: resetting preferences is not un-accepting.
  const settings = { ...Schema.defaults(), termsAccepted: load().termsAccepted }
  write(settings)
  return settings
}

/** Replace everything from an exported JSON object (unknown keys ignored). */
function importAll(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    return { settings: load(), errors: { _: 'That file is not a Yoinks settings export.' } }
  }
  // Terms acceptance is per person, not something an export carries over.
  const { termsAccepted, ...rest } = object
  const { settings, errors } = Schema.validate(rest, { ...Schema.defaults(), termsAccepted: load().termsAccepted })
  write(settings)
  return { settings, errors }
}

function outDir(settings = load()) {
  return settings.outDir || DEFAULT_OUT_DIR
}

module.exports = { SETTINGS_PATH, DEFAULT_OUT_DIR, load, update, reset, importAll, outDir }
