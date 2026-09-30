package com.yoinks.app.data.engine

import com.yoinks.app.domain.format.FormatPicker
import com.yoinks.app.domain.model.AppSettings
import com.yoinks.app.domain.model.FormatOption
import com.yoinks.app.domain.model.LinkRules
import com.yoinks.app.domain.model.MediaInfo
import com.yoinks.app.domain.model.MediaKind
import com.yoinks.app.domain.model.MusicCandidate
import com.yoinks.app.domain.model.Platform
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

/** yt-dlp JSON -> app models. Pure and tolerant of missing fields. */
object InfoParser {
    private const val MAX_VIDEO_CHOICES = 8

    fun parse(json: Json, raw: String, url: String, settings: AppSettings): MediaInfo {
        val info = json.parseToJsonElement(raw).jsonObject
        val platform = Platform.detect(url)
        val isPlaylist = info.string("_type") == "playlist"
        val formats = if (isPlaylist) playlistChoices(settings) else choices(info, settings)
        val videoCount = formats.count { it.kind == MediaKind.VIDEO }
        val defaultFormat = if (platform.isMusic) "audio" else settings.defaultFormat.key
        return MediaInfo(
            url = url,
            platform = platform,
            title = info.string("title") ?: info.string("fulltitle") ?: url,
            uploader = (info.string("artist") ?: info.string("uploader") ?: info.string("channel"))?.removeSuffix(" - Topic"),
            durationSeconds = info.number("duration")?.toLong(),
            thumbnail = thumbnail(info),
            isPlaylist = isPlaylist,
            playlistCount = if (isPlaylist) ((info["entries"] as? JsonArray)?.size ?: info.number("playlist_count")?.toInt()) else null,
            formats = formats,
            defaultIndex = FormatPicker.pick(formats, defaultFormat).coerceAtLeast(0),
            isSlideshow = platform == Platform.TIKTOK && videoCount == 0 && LinkRules.isTikTokSlideshow(url),
        )
    }

    private fun choices(info: JsonObject, settings: AppSettings): List<FormatOption> {
        val formats = (info["formats"] as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
        val audioOnly = formats.filter { it.codec("acodec") && !it.codec("vcodec") }
        val bestAudio = audioOnly.maxByOrNull { it.number("abr") ?: it.number("tbr") ?: 0.0 }
        val audioSize = bestAudio?.size()

        val videos = formats.filter { it.codec("vcodec") && (it.number("height") ?: 0.0) > 0 }
        val heights = videos.mapNotNull { it.number("height")?.toInt() }.distinct().sortedDescending()
        val options = heights.take(MAX_VIDEO_CHOICES).map { height ->
            val best = videos.filter { it.number("height")?.toInt() == height }.maxBy { score(it) }
            val muxed = best.codec("acodec")
            val size = (best.size() ?: 0L) + if (muxed) 0L else (audioSize ?: 0L)
            FormatOption(MediaKind.VIDEO, "${height}p", height, exact = true, ext = "mp4", sizeBytes = size.takeIf { it > 0 })
        }.toMutableList()
        if (options.isEmpty() && formats.any { it.codec("vcodec") }) {
            options += FormatOption(MediaKind.VIDEO, "Best available", ext = "mp4")
        }
        options += FormatOption(MediaKind.AUDIO, "Audio only", ext = settings.audioFormat.ext, sizeBytes = audioSize)
        return options
    }

    // Entries of a flat playlist have no formats yet: offer height caps.
    private fun playlistChoices(settings: AppSettings): List<FormatOption> =
        listOf(FormatOption(MediaKind.VIDEO, "Best", ext = "mp4")) +
            listOf(1080, 720, 480).map { FormatOption(MediaKind.VIDEO, "${it}p (max)", it, exact = false, ext = "mp4") } +
            FormatOption(MediaKind.AUDIO, "Audio only", ext = settings.audioFormat.ext)

    private fun score(f: JsonObject): Double {
        var score = f.number("tbr") ?: 0.0
        if (f.string("ext") == "mp4") score += 10_000
        if (f.string("vcodec")?.startsWith("avc") == true) score += 5_000
        return score
    }

    private fun thumbnail(info: JsonObject): String? {
        info.string("thumbnail")?.takeIf { it.startsWith("https://") }?.let { return it }
        return (info["thumbnails"] as? JsonArray)
            ?.mapNotNull { (it as? JsonObject)?.string("url") }
            ?.lastOrNull { it.startsWith("https://") }
    }

    /** One line of `--print %(.{…})j` from a music search. */
    fun searchResult(json: Json, line: String): MusicCandidate? {
        val obj = runCatching { json.parseToJsonElement(line).jsonObject }.getOrNull() ?: return null
        val id = obj.string("id") ?: return null
        return MusicCandidate(
            url = "https://music.youtube.com/watch?v=$id",
            title = obj.string("title").orEmpty(),
            artist = (obj.string("artist") ?: obj.string("channel")).orEmpty().removeSuffix(" - Topic"),
            album = obj.string("album"),
            durationSeconds = obj.number("duration")?.toLong(),
        )
    }

    // ---------- JSON helpers ----------

    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    private fun JsonObject.number(key: String): Double? = (this[key] as? JsonPrimitive)?.let { it.doubleOrNull ?: it.longOrNull?.toDouble() }
    private fun JsonObject.codec(key: String): Boolean = string(key)?.let { it != "none" } ?: false
    private fun JsonObject.size(): Long? = (number("filesize") ?: number("filesize_approx"))?.toLong()
}
