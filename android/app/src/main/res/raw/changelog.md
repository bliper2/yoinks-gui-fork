# Changelog

## 2.4.0

- Watched channels (Windows, Linux, extension): add a channel or playlist link in Settings, Queue. Yoinks checks it every 30 minutes while it is open and downloads new uploads by itself, in your default quality. Only uploads from after you add it are downloaded.
- Trim handles: when you choose "Only a clip", drag two sliders over the video's length instead of typing times. The time boxes still work and stay in step.
- Settings has a search box that finds a setting by name or description.
- The extension needs one new permission, "alarms", so the browser can wake it for the 30 minute channel check.

## 2.3.1

- Fixed: the arrow next to the Yoink button on a page did not open its menu on some sites, such as YouTube Music.
- Browser extension: the helper now finds Node.js even when the browser does not pass it on, and starts again by itself if it fails to start the first time.
- The helper keeps a small log at `.yoinks/helper.log` in your user folder, to help find out why it stopped.

## 2.3.0

- Linux: Yoinks now runs on Linux as an AppImage, a .deb and an .rpm. The AppImage updates itself, and the browser extension works with Chrome, Chromium, Brave, Edge, Vivaldi, Firefox, Waterfox and LibreWolf (not Snap or Flatpak browsers).
- New changelog page on the Yoinks website, always matching the latest release.
- Android: when yt-dlp still says it cannot read a page after a normal update, Yoinks now tries the nightly build once and retries.

## 2.2.0

- Type words instead of a link to search YouTube (Windows, extension, Android).
- Playlists: tick the videos you want before downloading.
- Settings has a health check for yt-dlp, ffmpeg, folders, storage and connection, with a button to copy the results.
- Errors have a "Copy details" button for asking for help on Discord or GitHub.
- Presets: save a combination like "Music FLAC" and pick it with one click (Windows, extension).
- The format list can remember your quality for each website.
- Windows: convert files on your PC to MP3, M4A, FLAC, Opus or MP4. Drop them on the window or use Batch.
- Only start downloads between set times (Windows, Android). Android can also wait on low battery or Data Saver.
- Sort files into folders by uploader or website, and split videos with chapters into one file per chapter.
- Extension: right-click "Yoink all videos on this page". The button also appears on Reddit, Facebook, Dailymotion, Streamable and Rumble.
- The Windows installer sets up the browser helper itself, so Node.js is not needed. Settings shows the extension folder to load.
- Windows asks before closing while downloads run, can offer links you copy, accepts dropped links, and the portable app downloads its own updates.
- Android: "Yoink copied link" tile and "Paste link" shortcut, pictures and a Share button in notifications.
- A "What's new" screen appears after each update (Windows, Android).
- Instagram posts that ask for a login are now retried later instead of failing at once.

## 2.1.1

- Only one Yoinks window runs at a time. Opening it a second time brings the first one to the front, instead of starting a second queue that overwrote the first one's history.
- Cancelling a download right after pausing it no longer leaves it stuck as paused.
- Links followed by punctuation, such as a comma or a closing bracket, now work when you paste them or use the right-click menu.
- yt-dlp updates itself again an hour after a failed update, instead of waiting a week.
- Windows and extension: when a site changes and yt-dlp can no longer read it, Yoinks now updates yt-dlp and tries once more by itself (if automatic updates are on).
- Spotify: if every search on YouTube Music fails, Yoinks shows the real error instead of "no matches".
- Android: a download that failed instantly could block a download slot until the app was restarted. Fixed.
- Android: if every song of a Spotify download fails, the real reason is shown instead of "no file was produced".

## 2.1.0

- New logo, used everywhere: Windows app and installer, browser extension, the Yoink button on pages, and the Android launcher and notifications.
- Four styles in Settings: Clean (the new default), Playful, Neon and Classic. Available on Windows, in the extension and on Android.
- The navigation buttons can be moved into a floating bar at the bottom of the window.
- Pinned Yoinks and shortcuts on Windows now show the Yoinks icon instead of the Electron one.
- The extension now works in Firefox 140+ and Waterfox. Install the .xpi file.
- Fixed: changing only the style didn't apply until another look setting changed.

## 2.0.2

- The portable exe can be pinned to the taskbar. Before, the pin pointed at a temporary copy and broke as soon as Yoinks closed.

## 2.0.1

- Android: the yt-dlp built into the app was months old, which broke TikTok ("Unable to extract webpage video data") and made public Instagram reels ask for cookies. The app now updates yt-dlp on first start and retries once after updating when a lookup fails.
- Instagram posts that really need a login now say so plainly, without asking you to import cookies.
- The Yoink button now shows on Instagram reel pages opened from a profile (/username/reel/...).
- Clearer error messages when a site changes and yt-dlp can't read it yet.

## 2.0.0

- First release of the new Yoinks: a Windows app, a browser extension for Brave, Chrome and Edge, and an Android app, all built on yt-dlp and ffmpeg.
- Downloads from YouTube, YouTube Music, TikTok, Instagram, SoundCloud, Bandcamp, X, Vimeo, Twitch and over 1,800 other sites.
- Spotify links are matched on YouTube Music and tagged with the Spotify title, artist, album and cover.
- Yoink buttons right on YouTube, YouTube Music, SoundCloud, TikTok and more, including "Yoink all" for playlists.
- Download queue with pause, resume, retries, parallel downloads and notifications.
- The Windows and Android apps update themselves from GitHub Releases.
- File sizes now match the quality you pick (before, every quality showed the same size).
- Cancelling or pausing a download on Windows now stops it completely.
- Fixed Arabic and other non-Latin file names on Windows.
