package com.yoinks.app.data.engine

import com.yoinks.app.domain.model.EngineProgress
import com.yoinks.app.domain.model.ItemProgress

/**
 * Reads yt-dlp's output lines (via youtubedl-android's callback) into
 * progress: percent, speed, time left, playlist item, post-processing.
 */
class ProgressParser {
    private var item: ItemProgress? = null
    private var processing = false

    private val ITEM = Regex("""\[download] Downloading item (\d+) of (\d+)""")
    private val SPEED = Regex("""at\s+(~?\s*[\d.]+\s*[KMG]?i?B/s)""")
    private val PROCESSING = Regex("""^\[(Merger|ExtractAudio|EmbedThumbnail|EmbedSubtitle|Metadata|ThumbnailsConvertor|FixupM4a|FixupM3u8|MetadataParser|ModifyChapters|VideoConvertor)]""")

    /** [percent] is 0–100 or negative when unknown (youtubedl-android's convention). */
    fun update(percent: Float, etaSeconds: Long, line: String): EngineProgress {
        val text = line.trim()
        ITEM.find(text)?.let {
            item = ItemProgress(it.groupValues[1].toInt(), it.groupValues[2].toInt())
            processing = false
        }
        when {
            PROCESSING.containsMatchIn(text) -> processing = true
            text.startsWith("[download]") && text.contains('%') -> processing = false
        }
        val speed = SPEED.find(text)?.groupValues?.get(1)?.replace(" ", "")?.removePrefix("~")
        return EngineProgress(
            fraction = if (processing) 1f else (percent / 100f).takeIf { percent >= 0f }?.coerceIn(0f, 1f),
            etaSeconds = etaSeconds.takeIf { it > 0 && !processing },
            speed = if (processing) null else speed,
            processing = processing,
            item = item,
        )
    }
}
