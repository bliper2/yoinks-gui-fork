package com.yoinks.app.domain.engine

/**
 * Which files yt-dlp left behind are the download.
 * Thumbnails and subtitle sidecars are dropped when a real media file exists.
 * A photo post whose only output is a picture is kept.
 */
object OutputFiles {
    private val junk = setOf("part", "ytdl", "json", "temp", "tmp")
    private val sidecar = setOf("webp", "jpg", "jpeg", "png", "vtt", "srt")
    private val photo = setOf("jpg", "jpeg", "png", "webp")

    fun finished(relativePaths: List<String>): List<String> {
        val files = relativePaths.filter { path ->
            val name = path.substringAfterLast('/')
            name.isNotEmpty() && !name.startsWith(".")
        }
        fun ext(path: String) = path.substringAfterLast('.', "").lowercase()
        val media = files.filter { ext(it) !in junk && ext(it) !in sidecar }
        if (media.isNotEmpty()) return media
        return files.filter { ext(it) in photo }
    }
}
