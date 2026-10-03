package com.yoinks.app.domain.support

/**
 * The short report people paste into Discord or a GitHub issue. Only what
 * is needed to find the problem: versions, the link and the error. No
 * settings, no file names, no cookies.
 */
object DebugReport {
    fun build(appVersion: String, device: String, ytdlpVersion: String?, url: String?, code: String, message: String, detail: String): String =
        listOfNotNull(
            "Yoinks $appVersion (Android)",
            "Device: $device",
            "yt-dlp: ${ytdlpVersion ?: "unknown"}",
            "Link: ${url ?: "-"}",
            "Error: $code - $message",
            detail.takeIf { it.isNotBlank() }?.let { "Details: $it" },
        ).joinToString("\n")
}
