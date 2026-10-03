'use strict'

// Starts a native messaging helper the way a browser would and checks that it
// answers. Sends a frame that is not JSON; a working helper replies with a
// "bad-request" error. Used by CI to prove the Linux launcher works.
//
//   node scripts/smoke-host.js <launcher> [args...]

const { spawn } = require('node:child_process')

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('usage: node scripts/smoke-host.js <launcher> [args...]')
  process.exit(2)
}

const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] })
const timer = setTimeout(() => fail('no reply within 60 seconds'), 60_000)

function fail(reason) {
  clearTimeout(timer)
  child.kill()
  console.error(`Helper did not answer: ${reason}`)
  process.exit(1)
}

child.on('error', error => fail(error.message))
child.on('exit', code => {
  if (code) fail(`exited with code ${code}`)
})

let received = Buffer.alloc(0)
child.stdout.on('data', chunk => {
  received = Buffer.concat([received, chunk])
  if (received.length < 4 || received.length < 4 + received.readUInt32LE(0)) return
  const reply = JSON.parse(received.subarray(4, 4 + received.readUInt32LE(0)).toString('utf-8'))
  clearTimeout(timer)
  child.stdin.end()
  if (reply.type === 'error' && reply.code === 'bad-request') {
    console.log('Helper answered.')
    process.exit(0)
  }
  fail(`unexpected reply ${JSON.stringify(reply)}`)
})

const body = Buffer.from('not json')
const header = Buffer.alloc(4)
header.writeUInt32LE(body.length)
child.stdin.write(Buffer.concat([header, body]))
