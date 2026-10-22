# Development

How to run Yoinks from source, how the code is laid out, and how a release is made.

## Requirements

- Windows 11 (10 works too) or Linux
- [Node.js](https://nodejs.org) 18 or newer, on `PATH`
- For the Android app: JDK 21 and the Android SDK (see [android/README.md](../android/README.md))

## Run the desktop app

```
npm install
npm start
```

If `npm start` says Electron failed to install, run `node node_modules\electron\install.js`, or use `start.bat`, which does it for you.

The first launch shows the Terms once, then downloads a standalone `yt-dlp.exe` to `%USERPROFILE%\.yoinks\bin` (`~/.yoinks/bin` on Linux). That copy updates itself weekly (Settings, yt-dlp, or **Update now**). A yt-dlp you installed yourself is left alone.

Settings live in `%APPDATA%\yoinks-gui\settings.json` (`~/.config/yoinks-gui` on Linux), validated by one schema and shared with the extension.

## Build installers

```
npm run dist:win      release/Yoinks-<version>-x64-setup.exe and -portable.exe
npm run dist:linux    AppImage, .deb and .rpm in release/
```

`ffmpeg` and `ffprobe` (about 100 MB each) are not in git. Put them in the project root before building: take them from an installed app's `resources/` folder or from [ffmpeg.org](https://ffmpeg.org/download.html). The Linux build also needs `rpm` installed for the .rpm. `npm start` does not need them: it falls back to a system ffmpeg or the `ffmpeg-static` package.

Windows builds are not code-signed, so SmartScreen may warn on first run.

## Browser extension from source

Browsers cannot run yt-dlp, so the extension talks to a small helper (`host/host.js`, a [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) host) that runs the same engine as the desktop app. The browser starts it when needed.

```
npm run extension:install     register the helper (per-user, no admin rights)
npm run extension:uninstall   remove it
```

Then load the `extension/` folder with **Load unpacked** in `chrome://extensions`, `brave://extensions` or `edge://extensions`. The extension ID is fixed (`ijjoaplmmifaojgihjaefpbobfgfdimp`) and the helper only answers that ID. Moved the project folder? Run `npm run extension:install` again.

Firefox and Waterfox use the same folder. Release Firefox only installs signed add-ons, so use `about:debugging`, **Load Temporary Add-on** and pick `extension/manifest.json`.

## Project layout

```
main/
  main.js          Electron main: window, IPC, controller with in-process backend
  updater.js       app updates from GitHub releases (electron-updater)
  helper.js        sets up the browser helper for the installed app
  ytdlp.js         the engine: find/update yt-dlp, probe, formats, searches,
                   settings -> yt-dlp arguments, downloads and conversions
core/              Node code shared by the desktop app and the browser helper
  session.js       one job or request: probe, download, pause, settings, files
  settings-store.js  reads/writes settings.json (validated)
  spotify.js       Spotify public metadata + YouTube Music matching
  match.js         match confidence scoring
  health.js        the Settings health check
  files.js         show in folder / open file (safety checks) / folder picker
  local-backend.js the desktop app's backend for the controller
host/
  host.js          native messaging wire format around core/session.js
  host.bat         launcher the browser starts
  install.js       registers / unregisters the helper
extension/         the browser extension, and the UI the desktop app shows
  manifest.json
  background.js    wires the controller to Chrome APIs (native helper, badge,
                   notifications, context menu, page buttons)
  app.html         the UI: popup, settings tab and desktop window
  shared/          plain scripts for the browser and Node:
    settings-schema.js  every setting: defaults, validation, labels
    controller.js       queue, lookups, retries, history, commands
    sites.js            supported sites and their special handling
    schedule.js         the download window
    filename-template.js, formats.js, errors.js
  ui/              theme.css (all colors), components.css, app.css,
                   theme.js, dom.js, toast.js, bridge.js, views/*
  content/         button.js (the in-page button), mounts.js (where it goes)
  legal/           terms.md, privacy.md; changelog.md is a copy of CHANGELOG.md
preload.js         the desktop window's bridge to main
android/           the Android app (separate Gradle project, GPL-3.0)
tests/             node:test suites for the shared logic, the engine and the queue
scripts/           changelog sync, extension packaging, Discord announcement
build/             Windows app icon, installer and packaging hooks
docs/              screenshots, logo, known issues, landing page
.github/           CI and release workflows, issue forms
```

`extension/shared` and `extension/ui` live inside `extension/` because a browser only loads files from the extension folder. The desktop app and the helper load the same files from there. There are no frameworks and no bundler: edit and reload.

## Tests

```
npm test                                   desktop, extension and shared logic
cd android && gradlew testDebugUnitTest    Android (also renders the screenshots)
```

CI runs both on every push. The tests fail when the version, the changelog copies or the extension's script list disagree.

The Android screenshots in the README are rendered from sample data with `gradlew testDebugUnitTest --tests com.yoinks.app.ScreenshotTest`.

## How updates work

- **Windows, installed:** checks the latest GitHub release at start and every 6 hours, downloads a newer version in the background and asks to restart.
- **Windows, portable:** cannot replace itself, so it downloads the new portable file next to the running one (after checking size and checksum) and tells you.
- **Linux:** the AppImage updates itself. The .deb and .rpm tell you when a new version is out.
- **Android:** checks at start and offers **Update**. It downloads the APK for the phone and opens Android's installer.
- **Extension:** unpacked extensions do not update themselves. Download the new zip (or `.xpi`) and click reload on the extension card.
- **yt-dlp:** updates itself weekly, and once more right away when a site stops working with the version you have.

## Publishing a new version

The version is the same everywhere. For a version such as `2.6.3`:

1. Set it in `package.json` (`npm pkg set version=2.6.3`), in `extension/manifest.json`, and as `versionName` (with a bigger `versionCode`) in `android/app/build.gradle.kts`.
2. Add a `## 2.6.3` section to [CHANGELOG.md](../CHANGELOG.md), short enough for one Discord message, and run `npm run sync` so the apps show it. `npm test` fails if the versions or the copies disagree.
3. Tag and push: `git tag v2.6.3 && git push origin v2.6.3`. The **Release** workflow builds the Windows installer and portable exe, the Linux AppImage, .deb and .rpm, and both extension downloads, then attaches them to a GitHub release named `Yoinks 2.6.3` with notes from that changelog section. It posts the changelog to Discord when the `DISCORD_WEBHOOK_URL` secret is set.
4. Android APKs: with the keystore secrets set (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`), the workflow attaches release APKs named `Yoinks-android-2.6.3-arm64-v8a.apk`, `...-armeabi-v7a.apk` and `...-universal.apk`. The in-app updater looks for those names. Without the secrets it attaches debug APKs (`com.yoinks.app.debug`) signed with a throwaway key, and those cannot update each other.

Android only installs an update when it is signed with the same key as the installed app. Keep the release keystore and its password somewhere safe: if you lose them, existing installs cannot be updated.
