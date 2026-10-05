'use strict'

// Native messaging host for the Yoinks browser extension.
// The browser starts this process (host.bat) and talks to it over
// stdin/stdout: a 4-byte little-endian length, then JSON. Chrome/Brave/Edge
// only start it for the extension ID in the host manifest (install.js).
//
// All the work happens in core/session.js — the same code the desktop app
// runs — so this file is only the wire format.
//
// stdout is the protocol channel: never console.log here.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { Session } = require('../core/session')

// A browser hides why a helper died, so keep a small local log of what it did
// and why it stopped: ~/.yoinks/helper.log (kept under 200 KB, local only).
const LOG = path.join(os.homedir(), '.yoinks', 'helper.log')
function log(line) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true })
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 200_000) fs.rmSync(LOG)
    fs.appendFileSync(LOG, `${new Date().toISOString()} [${process.pid}] ${line}
`)
  } catch {
    // logging must never break the helper
  }
}
log(`start node ${process.version} ${process.platform}`)
process.on('uncaughtException', error => {
  log(`uncaught ${error?.stack ?? error}`)
  process.exit(1)
})
process.on('unhandledRejection', error => log(`unhandled rejection ${error?.stack ?? error}`))
process.on('exit', code => log(`exit ${code}`))

const MAX_MESSAGE = 1024 * 1024 // Chrome's limit for host -> browser

function send(message) {
  const body = Buffer.from(JSON.stringify(message))
  if (body.length > MAX_MESSAGE) {
    send({ type: 'error', code: 'too-big', message: 'Reply too large for the browser.', retryable: false })
    return
  }
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length)
  process.stdout.write(Buffer.concat([header, body]))
}

const session = new Session(send)

// The browser went away while we were writing: nothing left to do.
process.stdout.on('error', error => {
  log(`stdout error ${error.code}`)
  session.close()
  process.exit(0)
})

let pending = Buffer.alloc(0)
process.stdin.on('data', chunk => {
  pending = Buffer.concat([pending, chunk])
  while (pending.length >= 4) {
    const length = pending.readUInt32LE(0)
    if (pending.length < 4 + length) break
    const body = pending.subarray(4, 4 + length)
    pending = pending.subarray(4 + length)
    let message
    try {
      message = JSON.parse(body.toString('utf-8'))
    } catch {
      send({ type: 'error', code: 'bad-request', message: 'Bad message from the extension.', retryable: false })
      continue
    }
    log(`message ${message?.type}`)
    session.handle(message)
  }
})

// Browser closed the port: stop whatever is running, clean up, exit.
process.stdin.on('end', () => {
  log('browser closed the port')
  session.close()
  process.exit(0)
})
