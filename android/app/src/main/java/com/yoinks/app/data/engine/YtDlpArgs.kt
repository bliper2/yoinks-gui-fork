package com.yoinks.app.data.engine

import com.yoinks.app.domain.format.FilenameTemplate
import com.yoinks.app.domain.model.AppSettings
import com.yoinks.app.domain.model.AudioFormat
import com.yoinks.app.domain.model.DownloadRequest
import com.yoinks.app.domain.model.MediaKind
import com.yoinks.app.domain.model.Platform
import java.io.File
import kotlin.math.floor

/**
 * Turns a request + validated settings into yt-dlp arguments. Pure, so it
 * is unit-tested; the link itself is never part of this list (it is passed
 * separately, after "--").
 */
object YtDlpArgs {
    private val AUDIO_SELECTOR = mapOf(
        AudioFormat.MP3 to "ba/b",
        AudioFormat.M4A to "ba[ext=m4a]/ba/b",
        AudioFormat.FLAC to "ba/b",
        AudioFormat.OPUS to "ba[acodec=opus]/ba/b",
    )

    // Music covers are often 16:9 frames with bars: crop them square.
    private val SQUARE_COVER = listOf("--ppa", "ThumbnailsConvertor+ffmpeg_o:-c:v mjpeg -vf crop=\"'if(gt(ih,iw),iw,ih)':'if(gt(iw,ih),ih,iw)'\"")

    fun cookies(settings: AppSettings, cookieFile: File?): List<String> =
        if (settings.useCookies && cookieFile != null && cookieFile.isFile) listOf("--cookies", cookieFile.absolutePath) else emptyList()

    fun probe(playlist: Boolean, settings: AppSettings, cookieFile: File?): List<String> =
        listOf("-J", "--no-warnings") +
            (if (playlist) listOf("--flat-playlist", "--yes-playlist") else listOf("--no-playlist")) +
            cookies(settings, cookieFile)

    fun searchMusic(limit: Int, settings: AppSettings, cookieFile: File?): List<String> =
        listOf("--no-warnings", "--skip-download", "--playlist-items", "1-$limit", "--print", "%(.{id,title,artist,album,duration,channel})j") +
            cookies(settings, cookieFile)

    fun format(request: DownloadRequest, settings: AppSettings, platform: Platform): List<String> {
        if (request.kind == MediaKind.AUDIO) {
            val quality = if (settings.audioFormat == AudioFormat.FLAC || settings.audioBitrate.kbps == null) "0" else "${settings.audioBitrate.kbps}K"
            return listOf("-f", AUDIO_SELECTOR.getValue(settings.audioFormat), "-x", "--audio-format", settings.audioFormat.ext, "--audio-quality", quality)
        }
        // TikTok marks its watermarked file with format_note "watermarked".
        val noMark = if (platform == Platform.TIKTOK && settings.tiktokNoWatermark) "[format_note!*=watermark]" else ""
        val height = request.format.toIntOrNull()
        val selector = when {
            height == null -> "bv*$noMark+ba/b$noMark/b"
            request.exactHeight -> "bv*[height=$height]$noMark+ba/b[height=$height]$noMark/bv*[height<=$height]+ba/b[height<=$height]/b"
            else -> "bv*[height<=$height]$noMark+ba/b[height<=$height]$noMark/b[height<=$height]/b"
        }
        return listOf("-f", selector, "--merge-output-format", "mp4")
    }

    /** Everything for a download except the source (link or info JSON). */
    fun download(
        request: DownloadRequest,
        settings: AppSettings,
        platform: Platform,
        outputDir: File,
        cookieFile: File?,
        forceTags: Boolean = false,
        playlistNames: Boolean = request.playlist,
    ): List<String> {
        val args = format(request, settings, platform).toMutableList()
        val audio = request.kind == MediaKind.AUDIO
        val music = platform.isMusic || forceTags

        request.clip?.let { clip ->
            val end = clip.endSeconds?.let { "$it" } ?: "inf"
            args += listOf("--download-sections", "*${clip.startSeconds}-$end", "--force-keyframes-at-cuts")
        }
        if (settings.embedMetadata || forceTags) args += "--embed-metadata"
        if (settings.embedThumbnail || forceTags) {
            args += listOf("--embed-thumbnail", "--convert-thumbnails", "jpg")
            if (music || audio) args += SQUARE_COVER
        }
        if (music) args += listOf("--replace-in-metadata", "uploader,channel,artist,album_artist", " - Topic$", "")
        if (settings.embedSubs && !audio) {
            val langs = if (settings.subsLang == "all") "all,-live_chat" else "${settings.subsLang}.*,${settings.subsLang},-live_chat"
            args += listOf("--embed-subs", "--sub-langs", langs)
        }
        if (settings.speedLimitMbps > 0f) args += listOf("--limit-rate", "${settings.speedLimitMbps}M")
        if (platform == Platform.TWITCH) args += listOf("--concurrent-fragments", "4")
        args += cookies(settings, cookieFile)
        // Files land in the gallery with today's date, not the upload date.
        args += "--no-mtime"

        val suffix = request.clip?.let { " (clip ${clock(it.startSeconds)}-${it.endSeconds?.let(::clock) ?: "end"})" }.orEmpty()
        val template = FilenameTemplate.toYtdlp(settings.filenameTemplate, playlistNames, settings.playlistFolder, settings.playlistNumbered, suffix)
        args += listOf("-o", File(outputDir, template).absolutePath)
        return args
    }

    private fun clock(seconds: Double): String {
        val s = floor(seconds).toLong()
        return "${s / 60}m${(s % 60).toString().padStart(2, '0')}s"
    }
}
