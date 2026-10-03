# Privacy

Short version: Yoinks runs on your phone and keeps your data there.

## What Yoinks does not do

- No ads.
- No tracking, analytics or crash reporting.
- No accounts and no sign-up.
- No Yoinks servers: nothing is sent to the people who make Yoinks.

## What leaves your phone

Only the requests needed to do what you asked:

- Requests to the site you download from (for example TikTok or YouTube), made by yt-dlp.
- Opening share short links (like vm.tiktok.com) to find the real page they point to.
- For Spotify links: a request to Spotify's public page for that link, and a search on YouTube Music.
- About once a week (you can change or turn this off in Settings): a check on GitHub for a newer yt-dlp.
- Each time you open Yoinks: a check on GitHub for a newer version of Yoinks. The update is only downloaded and installed if you tap Update and Install.
- When you type words instead of a link, the words are sent to YouTube's search, through yt-dlp.
- "Run health check" in Settings makes one small request to YouTube to test your connection.
- When a download finishes, its notification may show the video's picture, fetched from the site it came from.

## What is stored on your phone

- Your settings, and the list of your downloads (History). "Clear history" deletes the list; your files are only deleted if you choose that.
- Downloaded files, in Movies/Yoinks and Music/Yoinks (or the folders you choose).
- An imported cookies file, if you import one. It stays inside Yoinks, is never backed up, and "Remove" deletes it.

## Clipboard

Off by default. If you turn on "Look for links on the clipboard", Yoinks reads the clipboard only while it is open on your screen, to offer a link you copied. Nothing is stored or sent.

The "Yoink copied link" tile and the "Paste link" app shortcut read the clipboard once, only when you tap them, and only to download the link you copied.

## Battery and Data Saver

If you turn on "Wait while the battery is low" or "Respect Data Saver", Yoinks reads the battery level and Android's Data Saver state on this phone to decide when to start downloads. Nothing is sent anywhere.

## Permissions

- **Internet and network state**: to download, and to wait for Wi-Fi if you ask.
- **Install apps**: to install a Yoinks update you chose to download. Android asks you first.
- **Notifications**: to show progress and tell you when a download is done.
- **Foreground service and wake lock**: so downloads continue with the screen off.
- **Storage (Android 8 and 9 only)**: to save into Movies and Music. Newer Android versions don't need it.
