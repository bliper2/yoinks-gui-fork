# Security

## Reporting a problem

If you find a security problem in Yoinks (for example a way for a web page to make the extension download or open something it should not, or a way to make the helper run a command), please do not post it in public.

- Use **GitHub's private report**: on the repository, open the **Security** tab and choose **Report a vulnerability**.
- Or message the maintainer privately on the [Yoink Community Discord](https://discord.gg/yEF99JeG9b).

Please include the app (Windows, extension or Android), its version, and the steps to repeat it. You will get an answer as soon as possible, and a fix is released as a new version with a note in the [changelog](CHANGELOG.md).

## How Yoinks is built to keep you safe

- **No servers, no tracking.** Yoinks talks only to the sites you download from, GitHub (for updates) and, for Spotify links, Spotify's public page. See the Privacy notice in the app.
- **Links never become options.** A link is passed to yt-dlp after `--`, as its own argument, never through a shell. Search words go the same way.
- **The extension cannot choose what runs.** The browser extension talks to the helper by message; the helper only accepts known requests (look up, download by index, settings) and checks every value. File paths from the extension are checked before "Show in folder" or "Open".
- **The helper only answers the Yoinks extension.** Its registration names the extension's ID, so other extensions cannot start it.
- **Settings are validated** with one set of rules everywhere, so a damaged or hand-edited settings file cannot set a value the app does not allow.
- **Updates come from this repository's GitHub releases.** The Windows updater checks file hashes; the portable updater and the Android updater only download files from this repository's release address, and Android installs an update only if it is signed with the same key as the installed app.
- **Cookies are optional** and never leave your device except to the site they belong to.

## What is not protected

- Windows builds are not code-signed yet, so Windows SmartScreen may warn on first run. Check that you downloaded the file from this repository's [Releases](https://github.com/bliper2/yoinks-gui-fork/releases) page.
- Anything you download is your responsibility; Yoinks does not scan files.
