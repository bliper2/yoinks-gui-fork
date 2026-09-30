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

const { Session } = require('../core/session')

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
    session.handle(message)
  }
})

// Browser closed the port: stop whatever is running, clean up, exit.
process.stdin.on('end', () => {
  session.close()
  process.exit(0)
})
