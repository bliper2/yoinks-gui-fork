# yoinks

A small desktop app for pulling video or audio off the web. Paste a link, pick a resolution (or MP3), done.

Under the hood it's just [yt-dlp](https://github.com/yt-dlp/yt-dlp) doing the extraction and ffmpeg doing the muxing/encoding, wrapped in an Electron shell so you don't have to touch a terminal.

![main window](https://i.imgur.com/YWRSqEl.png)

## Features

- Paste a link, get a list of available formats — 144p up to 1080p, or audio-only as MP3
- Works with YouTube, X/Twitter, Instagram, Threads, TikTok, and the ~1,800 other sites yt-dlp knows how to extract from
- Ships with `ffmpeg`, `ffprobe`, and `ffplay` bundled — nothing else to install
- Pick your own output folder, defaults to remembering the last one used
- No accounts, no telemetry, no ads

## Screenshots

| Format picker | Downloading |
|---|---|
| ![format list](https://i.imgur.com/DDsjQof.png) | ![progress]() |

## Installation

### Download a build

Grab the latest release for your OS from the [Releases](../../releases) page and run it.

### Run from source

You'll need [Node.js](https://nodejs.org).

```bash
git clone https://github.com/yourname/yoinks-gui.git
cd yoinks-gui
npm install
npm start
```

`start.bat` is included for a quick launch on Windows if you'd rather not use `npm start` directly.

## How it works

1. Paste a URL into the box
2. yoinks queries yt-dlp for the formats available for that link
3. Pick a resolution or "Audio only"
4. ffmpeg handles the download/mux and drops the finished file in your chosen folder

## Project structure

```
yoinks-gui/
├─ main/          # Electron main process
├─ renderer/      # UI
├─ preload.js     # bridge between main and renderer
├─ ffmpeg.exe
├─ ffplay.exe
├─ ffprobe.exe
└─ package.json
```

## Disclaimer

This is meant as a personal-archiving tool. Only download content you actually have the right to keep, and respect the copyright and terms of service of whatever site you're pulling from.

## License

See [MRKRAPS].
