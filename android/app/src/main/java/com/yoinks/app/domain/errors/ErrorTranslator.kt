package com.yoinks.app.domain.errors

import com.yoinks.app.domain.model.Platform
import com.yoinks.app.domain.model.YoinksError
import com.yoinks.app.domain.model.YoinksException
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * Turns raw yt-dlp / ffmpeg / system errors into plain-English messages.
 * The rules match the Windows app; retryable errors get automatic retries.
 */
object ErrorTranslator {
    private data class Rule(val code: String, val test: Regex, val retryable: Boolean, val message: String)

    private fun rule(code: String, pattern: String, retryable: Boolean, message: String) =
        Rule(code, Regex(pattern, RegexOption.IGNORE_CASE), retryable, message)

    private val RULES = listOf(
        rule("drm", """\bDRM\b|drm.?protected""", false, "This content is DRM-protected. Yoinks does not bypass DRM, so it cannot be downloaded."),
        rule("cookies", """could not (copy|find|decrypt).*cookie|cookies? (file|database)|invalid cookie""", false, "The imported cookies file could not be used. Import it again in Settings."),
        rule("age", """confirm your age|age.?restricted|inappropriate for some users""", false, "This video is age-restricted. Import your browser cookies in Settings (while signed in) to download it."),
        rule("bot", """confirm you.?re not a bot|sign in to confirm""", false, "The site wants to check you are not a bot. Try again later, or import cookies in Settings."),
        rule("members", """members.?only|join this channel|channel.?s members|subscriber.?only""", false, "This is for members or subscribers only."),
        rule("private", """private video|this video is private|is private|private account""", false, "This video is private."),
        rule("login", """login required|log in|sign in to view|requires authentication|rate-limit reached or login|empty media response""", false, "The site needs you to be signed in. Import cookies in Settings to download this."),
        rule("region", """not (made this video )?available in your country|geo.?restrict|not available from your location""", false, "This video is blocked in your country."),
        rule("copyright", """copyright""", false, "This video was taken down for copyright reasons."),
        rule("live", """premieres in|live event will begin|this live event|is not currently live|upcoming live""", false, "This live stream or premiere has not started yet."),
        rule("removed", """video (is )?unavailable|video is not available|has been removed|no longer available|does not exist|not found \(404\)|HTTP Error 404""", false, "This video is unavailable. It may have been removed."),
        rule("unsupported", """unsupported url|no suitable extractor""", false, "This link is not supported. Try the link of the video page itself."),
        rule("format", """requested format is not available|no video formats found""", false, "That format is not available for this video. Pick another one."),
        rule("disk", """no space left|ENOSPC|disk (is )?full""", false, "Your phone is out of storage space."),
        rule("ratelimit", """HTTP Error 429|too many requests""", true, "The site is limiting downloads right now. Try again in a few minutes."),
        rule("forbidden", """HTTP Error 403|forbidden""", true, "The site refused the download (error 403). Updating yt-dlp in Settings usually fixes this."),
        rule("network", """timed out|timeout|connection (reset|refused|aborted)|unable to resolve host|getaddrinfo|ENOTFOUND|ECONNRESET|unable to download (webpage|json)|network is unreachable|failed to establish|SSL""", true, "No internet connection, or the connection dropped. Check your network and try again."),
        // Last: yt-dlp's hint for extractors a site change has broken.
        rule("outdated", """unable to extract|please report this issue|confirm you are on the latest version""", false, "yt-dlp could not read this page; the site probably changed. Update yt-dlp in Settings, then try again."),
    )

    fun translate(raw: String?, platform: Platform = Platform.OTHER): YoinksError {
        val text = raw.orEmpty()
        val detail = lastErrorLine(text)
        val match = RULES.firstOrNull { it.test.containsMatchIn(text) }
        if (match != null) {
            // Snapchat only exposes public Spotlight/story videos to yt-dlp.
            if (platform == Platform.SNAPCHAT && match.code in setOf("unsupported", "private", "login", "removed")) return snapchatPrivate(detail)
            if (platform == Platform.INSTAGRAM && match.code == "login") return instagramPrivate(detail)
            return YoinksError(match.code, match.message, match.retryable, detail)
        }
        if (platform == Platform.SNAPCHAT) return snapchatPrivate(detail)
        return YoinksError("unknown", detail.ifBlank { "Something went wrong." }, true, detail)
    }

    fun translate(error: Throwable, platform: Platform = Platform.OTHER): YoinksError = when (error) {
        is YoinksException -> error.error
        is UnknownHostException, is SocketTimeoutException ->
            YoinksError("network", "No internet connection, or the connection dropped. Check your network and try again.", true, error.message.orEmpty())
        is IOException -> translate(error.message ?: "network error", platform).let { if (it.code == "unknown") it.copy(code = "network", retryable = true) else it }
        else -> translate(error.message, platform)
    }

    // Public posts and reels work without an account; this one is not public.
    fun instagramPrivate(detail: String = "") = YoinksError(
        "instagram-private",
        "Instagram only shows this post to signed-in users, so it may be private or from a private account. Public posts and reels download fine.",
        false,
        detail,
    )

    fun snapchatPrivate(detail: String = "") = YoinksError(
        "snapchat-private",
        "Only public Snapchat Spotlight videos and public stories can be downloaded. Private snaps and chats cannot be saved.",
        false,
        detail,
    )

    /** The last "ERROR:" line without yt-dlp's "[extractor] id:" prefix. */
    private fun lastErrorLine(text: String): String {
        val lines = text.lines().map { it.trim() }.filter { it.isNotEmpty() }
        val line = lines.lastOrNull { it.startsWith("ERROR:") } ?: lines.lastOrNull().orEmpty()
        return line.removePrefix("ERROR:").trim()
            .replace(Regex("""^\[[^\]]+\]\s*[\w-]+:\s*"""), "")
            .replace(Regex("""^\[[^\]]+\]\s*"""), "")
            .take(300)
    }
}
