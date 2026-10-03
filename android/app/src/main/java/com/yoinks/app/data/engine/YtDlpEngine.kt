package com.yoinks.app.data.engine

import android.content.Context
import androidx.datastore.core.DataStore
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLException
import com.yausername.youtubedl_android.YoutubeDLRequest
import com.yausername.youtubedl_android.YoutubeDLResponse
import com.yoinks.app.data.cookies.CookieStore
import com.yoinks.app.data.spotify.SpotifyMetadata
import com.yoinks.app.domain.engine.MediaEngine
import com.yoinks.app.domain.engine.StoppedException
import com.yoinks.app.domain.engine.UpdateResult
import com.yoinks.app.domain.errors.ErrorTranslator
import com.yoinks.app.domain.model.AppSettings
import com.yoinks.app.domain.model.DownloadRequest
import com.yoinks.app.domain.model.EngineProgress
import com.yoinks.app.domain.model.LinkRules
import com.yoinks.app.domain.model.MediaInfo
import com.yoinks.app.domain.model.MusicCandidate
import com.yoinks.app.domain.model.Platform
import com.yoinks.app.domain.model.SearchResult
import com.yoinks.app.domain.model.SpotifyPick
import com.yoinks.app.domain.model.YoinksError
import com.yoinks.app.domain.model.YoinksException
import com.yoinks.app.domain.errors.ErrorTranslator.snapchatPrivate
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import java.io.File
import java.net.URLEncoder
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

/** [MediaEngine] backed by youtubedl-android (embedded Python + yt-dlp + ffmpeg). */
@Singleton
class YtDlpEngine @Inject constructor(
    @ApplicationContext private val context: Context,
    private val json: Json,
    private val cookies: CookieStore,
    private val scope: CoroutineScope,
    private val settingsStore: DataStore<AppSettings>,
) : MediaEngine {
    private val initLock = Mutex()
    @Volatile private var ready = false

    override suspend fun ensureReady() {
        if (ready) return
        withContext(Dispatchers.IO) {
            initLock.withLock {
                if (ready) return@withLock
                try {
                    YoutubeDL.getInstance().init(context)
                    FFmpeg.getInstance().init(context)
                } catch (e: YoutubeDLException) {
                    throw YoinksException(YoinksError("engine", "The download engine could not start. Reinstall Yoinks if this keeps happening.", false, e.message.orEmpty()), e)
                }
                ytdlpVersion = YoutubeDL.getInstance().version(context)
                ready = true
            }
        }
        // The yt-dlp bundled with the app ages fast: sites change and it
        // stops working. Update in the background right away when it is old.
        if (isOld(ytdlpVersion)) scope.launch { updateIfStale() }
    }

    /** Run yt-dlp. [urls] go last, after "--", so they can never be read as options. */
    private suspend fun run(
        args: List<String>,
        urls: List<String>,
        platform: Platform,
        processId: String? = null,
        callback: ((Float, Long, String) -> Unit)? = null,
    ): YoutubeDLResponse = withContext(Dispatchers.IO) {
        ensureReady()
        require(urls.all { it.startsWith("https://") || it.startsWith("http://") || SEARCH_URL.matches(it) }) { "Only web links can be downloaded." }
        val versionBefore = ytdlpVersion
        val request = YoutubeDLRequest(urls).addCommands(args + if (urls.isEmpty()) emptyList() else listOf("--"))
        try {
            try {
                YoutubeDL.getInstance().execute(request, processId, callback)
            } catch (e: YoutubeDLException) {
                // An old yt-dlp can't read a changed site; it then says "unable
                // to extract", "login required" (Instagram) or 403. Update now
                // and try once more; a real private post fails again.
                val code = ErrorTranslator.translate(e.message).code
                if (code !in RETRY_AFTER_UPDATE) throw e
                updateIfStale()
                // Already on the newest stable: a site fix may only be in the nightly build.
                if (ytdlpVersion == versionBefore && code == "outdated") updateToNightly()
                if (ytdlpVersion == versionBefore) throw e
                YoutubeDL.getInstance().execute(request, processId, callback)
            }
        } catch (e: YoutubeDL.CanceledException) {
            throw StoppedException()
        } catch (e: YoutubeDLException) {
            throw YoinksException(ErrorTranslator.translate(e.message, platform), e)
        }
    }

    private val updateLock = Mutex()
    @Volatile private var lastAutoUpdate = 0L
    @Volatile private var lastNightlyUpdate = 0L
    @Volatile private var ytdlpVersion: String? = null

    /**
     * Update yt-dlp (when auto-update is on in Settings) unless that was tried
     * in the last 30 minutes; waits for one already running.
     */
    private suspend fun updateIfStale() = updateLock.withLock {
        if (!settingsStore.data.first().ytdlpAutoUpdate) return@withLock
        val now = System.currentTimeMillis()
        if (now - lastAutoUpdate < AUTO_UPDATE_EVERY_MS) return@withLock
        lastAutoUpdate = now
        runCatching { update() }
    }

    /** Switch to yt-dlp's nightly build (at most once an hour); sites are fixed there first. */
    private suspend fun updateToNightly() = updateLock.withLock {
        if (!settingsStore.data.first().ytdlpAutoUpdate) return@withLock
        val now = System.currentTimeMillis()
        if (now - lastNightlyUpdate < NIGHTLY_EVERY_MS) return@withLock
        lastNightlyUpdate = now
        runCatching {
            YoutubeDL.getInstance().updateYoutubeDL(context, YoutubeDL.UpdateChannel.NIGHTLY)
            ytdlpVersion = YoutubeDL.getInstance().version(context)
        }
    }

    /** yt-dlp versions are dates ("2025.11.12"); older than 60 days counts as old. */
    private fun isOld(version: String?): Boolean {
        val date = version?.let { runCatching { LocalDate.parse(it.take(10).replace('.', '-')) }.getOrNull() } ?: return false
        return date.isBefore(LocalDate.now().minusDays(60))
    }

    override suspend fun probe(url: String, playlist: Boolean, settings: AppSettings): MediaInfo {
        val platform = Platform.detect(url)
        if (platform == Platform.SNAPCHAT && !LinkRules.isSnapchatPublic(url)) throw YoinksException(snapchatPrivate())
        val response = run(YtDlpArgs.probe(playlist || LinkRules.isPlaylistLink(url), settings, cookies.file), listOf(url), platform)
        return try {
            InfoParser.parse(json, response.out, url, settings)
        } catch (e: Exception) {
            throw YoinksException(YoinksError("parse", "Could not read the video details from yt-dlp.", true, e.message.orEmpty()), e)
        }
    }

    override suspend fun searchVideos(query: String, settings: AppSettings): List<SearchResult> {
        val text = query.replace(Regex("[\u0000-\u001f]"), " ").trim().take(200)
        if (text.isEmpty()) throw YoinksException(YoinksError("bad-request", "Type something to search for.", false))
        // "ytsearch8:words" goes after "--" like any link, so the words can never be options.
        val response = run(YtDlpArgs.searchVideos(settings, cookies.file), listOf("ytsearch8:$text"), Platform.YOUTUBE)
        return try {
            InfoParser.searchResults(json, response.out)
        } catch (e: Exception) {
            throw YoinksException(YoinksError("parse", "Could not read the search results.", true, e.message.orEmpty()), e)
        }
    }

    override suspend fun searchMusic(query: String, limit: Int, settings: AppSettings): List<MusicCandidate> {
        val url = "https://music.youtube.com/search?q=${URLEncoder.encode(query, "UTF-8")}#songs"
        val response = run(YtDlpArgs.searchMusic(limit, settings, cookies.file), listOf(url), Platform.YOUTUBE_MUSIC)
        return response.out.lineSequence().mapNotNull { InfoParser.searchResult(json, it) }.toList()
    }

    override suspend fun download(
        request: DownloadRequest,
        settings: AppSettings,
        outputDir: File,
        processId: String,
        onProgress: (EngineProgress) -> Unit,
    ): List<File> {
        val platform = Platform.detect(request.url)
        outputDir.mkdirs()
        val args = YtDlpArgs.download(request, settings, platform, outputDir, cookies.file) +
            (if (request.playlist) "--yes-playlist" else "--no-playlist")
        val parser = ProgressParser()
        run(args, listOf(request.url), platform, processId) { percent, eta, line -> onProgress(parser.update(percent, eta, line)) }
        return finishedFiles(outputDir)
    }

    override suspend fun downloadSpotify(
        pick: SpotifyPick,
        settings: AppSettings,
        outputDir: File,
        processId: String,
        onProgress: (EngineProgress) -> Unit,
    ): List<File> {
        outputDir.mkdirs()
        // Look the match up, put Spotify's tags and cover on it, download that.
        val info = run(YtDlpArgs.probe(false, settings, cookies.file), listOf(pick.candidateUrl), Platform.YOUTUBE_MUSIC)
        val patched = SpotifyMetadata.apply(json.parseToJsonElement(info.out).jsonObject, pick)
        val infoFile = File(outputDir, ".info-${pick.index}.json").apply { writeText(patched.toString()) }
        val request = DownloadRequest(url = pick.candidateUrl, title = pick.track.title, format = "audio")
        val args = YtDlpArgs.download(request, settings, Platform.YOUTUBE_MUSIC, outputDir, cookies.file, forceTags = true, playlistNames = pick.collectionTitle != null) +
            listOf("--no-playlist", "--load-info-json", infoFile.absolutePath)
        val parser = ProgressParser()
        try {
            run(args, emptyList(), Platform.YOUTUBE_MUSIC, processId) { percent, eta, line -> onProgress(parser.update(percent, eta, line)) }
        } finally {
            infoFile.delete()
        }
        return finishedFiles(outputDir)
    }

    override fun stop(processId: String) {
        YoutubeDL.getInstance().destroyProcessById(processId)
    }

    override suspend fun version(): String? = withContext(Dispatchers.IO) {
        ensureReady()
        YoutubeDL.getInstance().version(context)
    }

    override suspend fun update(): UpdateResult = withContext(Dispatchers.IO) {
        ensureReady()
        val before = YoutubeDL.getInstance().version(context)
        val status = try {
            YoutubeDL.getInstance().updateYoutubeDL(context, YoutubeDL.UpdateChannel.STABLE)
        } catch (e: YoutubeDLException) {
            throw YoinksException(ErrorTranslator.translate(e).copy(message = "yt-dlp could not be updated. Check your connection and try again."), e)
        }
        val after = YoutubeDL.getInstance().version(context)
        ytdlpVersion = after
        val updated = status == YoutubeDL.UpdateStatus.DONE
        UpdateResult(after, updated, if (updated) "Updated yt-dlp to $after." else "yt-dlp is already up to date ($before).")
    }

    /** Media files yt-dlp left in [dir] (not partials, temp or info files). */
    private fun finishedFiles(dir: File): List<File> =
        dir.walkTopDown()
            .filter { it.isFile && !it.name.startsWith(".") }
            .filterNot { f -> PARTIAL.any { f.name.endsWith(it) } }
            .toList()

    private companion object {
        const val AUTO_UPDATE_EVERY_MS = 30 * 60 * 1000L
        const val NIGHTLY_EVERY_MS = 60 * 60 * 1000L
        val SEARCH_URL = Regex("^ytsearch[0-9]{1,2}:.+")
        val RETRY_AFTER_UPDATE = setOf("outdated", "login", "forbidden")
        val PARTIAL = listOf(".part", ".ytdl", ".json", ".temp", ".tmp", ".webp", ".jpg", ".png", ".vtt", ".srt")
    }
}
