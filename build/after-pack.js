'use strict'

// electron-builder hook. "signAndEditExecutable": false (package.json) avoids
// the winCodeSign download that fails without symlink rights, but it also
// skips putting our icon and name into Yoinks.exe. Do that here with rcedit.
const fs = require('node:fs')
const path = require('node:path')
const { rcedit } = require('rcedit')

// Linux: an AppImage cannot carry the SUID sandbox helper, so Electron must start with
// --no-sandbox. Set from code that is too late for its helper processes (black window),
// so the real binary is renamed and a launcher adds the flag when run from an AppImage.
function wrapLinux(context) {
  const name = context.packager.executableName
  const bin = path.join(context.appOutDir, name)
  fs.renameSync(bin, `${bin}.bin`)
  fs.writeFileSync(bin, `#!/bin/sh\nHERE=$(dirname "$(readlink -f "$0")")\n[ -n "$APPIMAGE" ] && set -- --no-sandbox "$@"\nexec "$HERE/${name}.bin" "$@"\n`, { mode: 0o755 })
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'linux') return wrapLinux(context)
  if (context.electronPlatformName !== 'win32') return
  const { productFilename, info } = context.packager.appInfo
  const exe = path.join(context.appOutDir, `${productFilename}.exe`)
  await rcedit(exe, {
    icon: path.join(__dirname, 'icon.ico'),
    'file-version': info.version ?? context.packager.appInfo.version,
    'product-version': context.packager.appInfo.version,
    'version-string': {
      ProductName: productFilename,
      FileDescription: productFilename,
      CompanyName: 'Yoinks',
      LegalCopyright: 'MIT',
      OriginalFilename: `${productFilename}.exe`,
    },
  })
}
