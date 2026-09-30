package com.yoinks.app.domain.link

import java.net.URI

/**
 * Finds links in shared text. TikTok, Snapchat and others share a caption
 * with the link inside it ("Check this out! https://vm.tiktok.com/ZM… #fyp").
 * Only http(s) links with a host are returned, so nothing else can ever
 * reach yt-dlp.
 */
object LinkExtractor {
    private val URL = Regex("""https?://[^\s<>"'`{}|\\^]+""", RegexOption.IGNORE_CASE)

    // Share texts sometimes drop the scheme for well-known short links.
    private val BARE = Regex(
        """(?<![\w./])((?:vm|vt)\.tiktok\.com/\S+|youtu\.be/\S+|snapchat\.com/t/\S+|on\.soundcloud\.com/\S+)""",
        RegexOption.IGNORE_CASE,
    )

    private const val TRAILING = ".,;:!?)]}>'\"»”’…"

    fun extractAll(text: String?): List<String> {
        if (text.isNullOrBlank()) return emptyList()
        val found = URL.findAll(text).map { it.value } +
            BARE.findAll(text).map { "https://${it.groupValues[1]}" }
        return found.mapNotNull { normalize(it) }.distinct().toList()
    }

    fun first(text: String?): String? = extractAll(text).firstOrNull()

    /** A clean http(s) URL, or null. Trims punctuation that followed the link. */
    fun normalize(raw: String): String? {
        var s = raw.trim()
        while (s.isNotEmpty() && s.last() in TRAILING) {
            // Keep a closing bracket that belongs to the URL, e.g. …_(song)
            if (s.last() == ')' && s.count { it == '(' } >= s.count { it == ')' }) break
            s = s.dropLast(1)
        }
        val uri = runCatching { URI(s) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host ?: return null
        if (!host.contains('.') || uri.userInfo != null) return null
        return uri.toString()
    }
}
