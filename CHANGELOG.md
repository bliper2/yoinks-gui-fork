# Changelog

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
