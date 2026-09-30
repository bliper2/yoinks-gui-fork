# Privacy

Short version: Yoinks runs on your computer and keeps your data there.

## What Yoinks does not do

- No ads.
- No tracking, analytics or telemetry.
- No accounts and no sign-up.
- No Yoinks servers: nothing is sent to the people who make Yoinks.

## What leaves your computer

Only the requests needed to do what you asked:

- Requests to the website you are downloading from (for example YouTube or SoundCloud), made by yt-dlp.
- For Spotify links: a request to Spotify's public page for that link (to read the song name, artist and cover), and a search on YouTube Music.
- Once a week (you can turn this off in Settings), a check on GitHub for a newer version of yt-dlp.

## What is stored on your computer

- Your settings, in `%APPDATA%\yoinks-gui\settings.json`.
- Your list of recent downloads, inside your browser's extension storage (for the extension) or in the app's data folder (for the desktop app). "Clear history" in Settings deletes it. Your downloaded files are never deleted by Yoinks.
- yt-dlp itself, in `%USERPROFILE%\.yoinks\bin`.

## Browser cookies

This is off unless you turn it on. When it is on, yt-dlp reads the login cookies of the browser you choose, on this computer, and sends them only to the website you are downloading from, so the site treats you as signed in. Yoinks does not store, copy or send your cookies anywhere else.

## Permissions the extension asks for

- **Talk to the Yoinks helper** (native messaging): the extension cannot run yt-dlp itself, so a small helper program on your PC does the downloading.
- **Access to YouTube, YouTube Music, SoundCloud, Bandcamp, TikTok, Instagram, X, Vimeo and Twitch**: only to show the Yoink button on their pages and to read where a video is playing (for clips).
- **Notifications**, **context menus** and **storage**: for "download finished" messages, the right-click menu, and remembering your recent downloads.
