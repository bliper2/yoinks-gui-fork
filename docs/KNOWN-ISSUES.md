# Known issues and quick fixes

Before you report a problem, try the first fix for it here. Most download problems come from a site changing, which an updated yt-dlp fixes.

**First thing to try for almost anything:** Settings, **Health check**, then **Update now** under yt-dlp. (Android and Windows also update yt-dlp by themselves.)

## "Unable to extract…" or "yt-dlp could not read this page"

The site changed and your yt-dlp is too old. Update it (Settings, yt-dlp, Update now) and try again. Yoinks also does this by itself once, if automatic updates are on.

## Instagram says the post needs a login

- Public posts and reels work without an account.
- If it still fails, the post may be private, from a private account, or limited by age. Instagram also answers this way when it is slowing down a connection: wait a few minutes and try again, or switch between Wi-Fi and mobile data.
- Desktop and extension only: turn on **Use browser cookies** in Settings while you are signed in to Instagram in that browser. Android: import a cookies file in Settings.

## HTTP error 403 or "the site refused the download"

Usually a temporary refusal or an old yt-dlp. Update yt-dlp, wait a minute, and try again. A VPN can cause it.

## "Sign in to confirm you are not a bot" (YouTube)

YouTube sometimes asks this of busy networks and VPNs. Wait, switch network, or use **Use browser cookies** in Settings (desktop and extension).

## Age-restricted or members-only videos

They need you to be signed in: use **Use browser cookies** (desktop, extension) or import cookies (Android).

## Spotify link shows "no match"

Yoinks never downloads from Spotify. It finds the same song on YouTube Music. A brand-new or very obscure song may not be there yet; pick another result from the list, or skip it.

## SmartScreen warns when I run the Windows app

The builds are not code-signed yet. Click **More info**, then **Run anyway**, after checking you downloaded the file from this repository's Releases page.

## The browser extension says the helper is not installed

- **Installed Windows app:** start Yoinks once, restart the browser, and check Settings, **Browser extension**. It should say the helper is set up.
- **Portable app or running from source:** the helper needs Node.js: run `npm run extension:install` in the Yoinks folder once.
- If you moved the folder, run it again.

## The extension works in Brave or Chrome but not in Firefox or Waterfox

Install the `.xpi` file from the release (open it with the browser and click Add). Firefox itself only allows signed add-ons: use Waterfox, Firefox Developer Edition, or `about:debugging` (temporary).

## Pinned portable app shows a broken shortcut

Pin the portable exe once it is where you want to keep it, and do not move or rename it afterwards. When an update downloads a new portable file, unpin the old one and pin the new one.

## Linux: the AppImage will not start

Make it executable first (`chmod +x Yoinks-*.AppImage`). On a system without FUSE 2 (Ubuntu 22.04 and newer), install `libfuse2` (`libfuse2t64` on Ubuntu 24.04), or run it with `--appimage-extract-and-run`. The .deb and .rpm do not need FUSE.

## Linux: the browser extension says the helper is not installed

- Start Yoinks once, then restart the browser. Yoinks writes the helper files into the profile folder of every browser it finds (Chrome, Chromium, Brave, Edge, Vivaldi, Firefox, Waterfox, LibreWolf), so the browser must have been started once before Yoinks.
- Browsers installed as a **Snap or Flatpak** (the default Firefox on Ubuntu, for example) run in a sandbox and cannot start the helper. Use a browser installed from a normal package, or a `.deb` / tarball build.
- From source: run `npm run extension:install` in the Yoinks folder (needs Node.js).

## Linux: no folder dialog, or no sound or thumbnails

Choosing the folder from the extension needs `zenity` (GNOME and most desktops) or `kdialog` (KDE). The desktop app has its own dialog. Yoinks uses the bundled ffmpeg; a system `ffmpeg` is the fallback when running from source.

## Android: downloads stop when I leave the app

Set **Settings, Apps, Yoinks, Battery** to **Unrestricted**. Some phone makers also need "Autostart" or "Lock in recents" turned on for Yoinks.

## Android: the update will not install

Android installs an update only over an app signed with the same key. If you installed Yoinks from a different source, uninstall it first (your downloads stay in Movies and Music), then install the new file.

---

Not listed? Run **Health check**, tap **Copy results** (or **Copy details** on the error) and ask on the [Discord](https://discord.gg/yEF99JeG9b) or open a [GitHub issue](https://github.com/bliper2/yoinks-gui-fork/issues/new/choose).
