# Yoinks for Android

Save videos and music from TikTok, YouTube, YouTube Music, Instagram, Snapchat
Spotlight, X, Facebook, Reddit, SoundCloud, Vimeo, Twitch and 1,800+ other
sites — straight from the Android share sheet. Spotify links are matched on
YouTube Music (no DRM is bypassed). yt-dlp and ffmpeg run on the phone.

> **Not on Google Play.** Google Play does not allow apps that download from
> YouTube, so Yoinks is meant for sideloading (for example from GitHub
> Releases). Only install APKs from a source you trust.

## Stack

- **Kotlin + Jetpack Compose + Material 3**, one activity, MVVM with
  `domain` (pure Kotlin rules), `data` (engine, storage, queue) and `ui` layers.
- **youtubedl-android** (JunkFood02 fork) bundles yt-dlp, Python and ffmpeg for
  arm64-v8a and armeabi-v7a. It sits behind the `MediaEngine` interface, so it
  can be swapped or faked.
- **Hilt** (DI), **Room** (history), **DataStore** (settings, one JSON document),
  **WorkManager** (weekly yt-dlp update), a **foreground service** (downloads
  keep running with the app closed or the screen off).

Why native and not Capacitor/web: yt-dlp needs a real Python process and file
system access, long-running foreground work and deep share-sheet integration —
all first-class in native Android and awkward through a WebView bridge.

## Project layout

```
app/src/main/java/com/yoinks/app/
  domain/        pure rules, unit-tested: models, link extraction, platform
                 detection, error messages, file-name templates, settings
                 validation, format picking, Spotify match scoring, MediaEngine
  data/          engine (youtubedl-android + yt-dlp arguments + parsers),
                 link resolver (short links), Spotify metadata, settings
                 (DataStore), history (Room), storage (MediaStore / SAF),
                 download queue, network monitor, cookies
  service/       foreground download service + notifications
  work/          yt-dlp auto-update worker
  ui/            theme, components (state button, markdown, color picker),
                 share sheet, Home, Queue, History, Settings, Terms/Privacy,
                 adaptive shell (bottom bar / rail / two panes)
  MainActivity   share (ACTION_SEND) and "Open with" (ACTION_VIEW) intents
app/src/main/res/raw/  terms.md, privacy.md, about.md — edit the texts here
app/src/test/          unit tests for the pure logic
```

## Build on Windows 11 with Android Studio

1. Install [Android Studio](https://developer.android.com/studio) (latest).
   It brings its own JDK and Android SDK.
2. **File → Open…** and pick this `android` folder. Let Gradle sync finish
   (first time: several minutes; it downloads Gradle 9.8 and dependencies).
3. **Debug APK:** **Build → Build App Bundle(s) / APK(s) → Build APK(s)**, or in
   the Terminal tab:

   ```
   gradlew assembleDebug
   ```

   APKs: `app\build\outputs\apk\debug\` — `app-arm64-v8a-debug.apk` for
   nearly all phones from the last 8 years, `app-armeabi-v7a-debug.apk` for old
   32-bit phones, `app-universal-debug.apk` if unsure.

4. **Run the unit tests:** `gradlew testDebugUnitTest`

## Signed release APK

1. Create a signing key once (keep the file and passwords safe — you need the
   same key for every update):

   ```
   keytool -genkeypair -v -keystore yoinks-release.jks -alias yoinks -keyalg RSA -keysize 4096 -validity 10000
   ```

   (`keytool` is in Android Studio's `jbr\bin` folder, e.g.
   `"C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe"`.)
2. Create `android\keystore.properties` (it is git-ignored):

   ```
   storeFile=yoinks-release.jks
   storePassword=YOUR_STORE_PASSWORD
   keyAlias=yoinks
   keyPassword=YOUR_KEY_PASSWORD
   ```

3. Build: `gradlew assembleRelease` (R8 shrinking is on). Signed APKs:
   `app\build\outputs\apk\release\app-<abi>-release.apk`. Without
   `keystore.properties` you get `-release-unsigned.apk` files, which phones
   will not install.

## Install on a phone

**Copy the file:** copy the APK to the phone (USB, cloud drive, Nearby Share),
tap it in the Files app, and when Android asks, allow **Install unknown apps**
for that Files app (Settings → Apps → Special app access → Install unknown
apps). Then tap **Install**.

**Over USB with adb:** on the phone enable **Developer options** (tap *Build
number* 7 times in Settings → About phone) and **USB debugging**, connect it,
accept the prompt, then:

```
adb install -r app\build\outputs\apk\debug\app-arm64-v8a-debug.apk
```

(`adb` is in `%LOCALAPPDATA%\Android\Sdk\platform-tools`.) Or just press
**Run ▶** in Android Studio with the phone selected.

After installing: open Yoinks once, accept the terms, and allow notifications.
For long downloads, set Settings → Apps → Yoinks → Battery → **Unrestricted**.

## How it works

- **Share sheet:** Yoinks accepts shared text, finds the link inside captions
  (TikTok/Snapchat), resolves short links (vm.tiktok.com, snapchat.com/t/…) with
  a limited number of http(s)-only redirects, detects the platform, looks the
  link up and shows a sheet with thumbnail, title, author, duration and
  qualities with sizes. "Download instantly on share" skips the sheet.
- **Safety:** only http(s) links are accepted; the link is passed to yt-dlp as
  a separate argument after `--`, never through a shell or as an option.
- **Downloads:** a queue with a set number of parallel downloads, pause/resume
  (partial files are kept), automatic retries for network errors, Wi-Fi-only
  mode, and a foreground-service notification with Pause/Cancel. Files go to
  Movies/Yoinks and Music/Yoinks via MediaStore (visible in Gallery and music
  apps) or to folders you pick. Unfinished downloads survive the app being
  killed and come back paused.
- **Spotify:** public metadata from the link's embed page → YouTube Music
  search → matches with a confidence score you can change → download with
  Spotify's title, artist, album and cover written into the file.

## What else it does

- **Search:** type words on Home instead of a link and pick from the YouTube results.
- **Playlists:** tick the videos you want before downloading.
- **Quick paste:** a Quick Settings tile ("Yoink copied link") and a long-press
  app shortcut ("Paste link") download the link on the clipboard. The
  clipboard is read once, only when you tap them.
- **Waits when it should:** Wi-Fi only, Data Saver, low battery (15% or less,
  not charging) and an optional download window ("only between 01:00 and 07:00").
- **Remembers quality per website** (a checkbox in the sheet; Settings lists and forgets them).
- **Folders and chapters:** sort files by uploader or website, and optionally
  split videos with chapters into one file per chapter.
- **Notifications** show the video's picture and a Share button.
- **Health check** (Settings) tests yt-dlp, ffmpeg, your folders, storage and
  connection; **Copy details** on an error gives you a report to paste into
  Discord or a GitHub issue.
- **What's new** appears once after an update (from `res/raw/changelog.md`, a
  copy of the repository's CHANGELOG.md made by `npm run sync`).

## Updates

At start Yoinks checks the latest GitHub release of
[bliper2/yoinks-gui-fork](https://github.com/bliper2/yoinks-gui-fork/releases)
(tag `v<versionName>`). If it is newer, **Update** downloads
`Yoinks-android-<version>-<abi>.apk` (or `…-universal.apk`) and opens Android's
installer. Android only accepts it when it is signed with the same key as the
installed app. Publishing steps: see the main README, "Publishing a new version".

## Screenshots

`gradlew testDebugUnitTest --tests com.yoinks.app.ScreenshotTest` renders the
main screens from their preview data (Robolectric + Roborazzi, no phone) to
`app/build/screenshots/`.

## Support

Help, bugs and ideas: [Yoink Community on Discord](https://discord.gg/yEF99JeG9b) or [GitHub issues](https://github.com/bliper2/yoinks-gui-fork/issues).

## License

GPL-3.0 (Yoinks for Android includes youtubedl-android, which is GPL-3.0).
yt-dlp is public domain; FFmpeg is LGPL/GPL. See the About screen.
