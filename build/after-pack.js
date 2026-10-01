'use strict'

// electron-builder hook. "signAndEditExecutable": false (package.json) avoids
// the winCodeSign download that fails without symlink rights, but it also
// skips putting our icon and name into Yoinks.exe. Do that here with rcedit.
const path = require('node:path')
const { rcedit } = require('rcedit')

exports.default = async function afterPack(context) {
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
