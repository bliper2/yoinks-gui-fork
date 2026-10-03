package com.yoinks.app.domain.engine

import com.yoinks.app.domain.model.AppSettings
import com.yoinks.app.domain.model.DownloadRequest
import com.yoinks.app.domain.model.EngineProgress
import com.yoinks.app.domain.model.MediaInfo
import com.yoinks.app.domain.model.MusicCandidate
import com.yoinks.app.domain.model.SearchResult
import com.yoinks.app.domain.model.SpotifyPick
import java.io.File

/**
 * Everything that runs yt-dlp. The app only talks to this interface, so the
 * engine (youtubedl-android today) can be swapped or faked in tests.
 * All functions are main-safe; long work runs on background threads.
 */
interface MediaEngine {
    /** Unpack Python/yt-dlp/ffmpeg on first use (a few seconds, once). */
    suspend fun ensureReady()

    /** Look a link up without downloading. [playlist] lists the whole list. */
    suspend fun probe(url: String, playlist: Boolean, settings: AppSettings): MediaInfo

    /** Videos matching a text search on YouTube. */
    suspend fun searchVideos(query: String, settings: AppSettings): List<SearchResult>

    /** Top YouTube Music song results, each resolved (artist, album, duration). */
    suspend fun searchMusic(query: String, limit: Int, settings: AppSettings): List<MusicCandidate>

    /**
     * Download [request] into [outputDir] (app-private). Returns the finished
     * files. [processId] identifies the run for [stop]. Throws
     * [StoppedException] when stopped on purpose.
     */
    suspend fun download(
        request: DownloadRequest,
        settings: AppSettings,
        outputDir: File,
        processId: String,
        onProgress: (EngineProgress) -> Unit,
    ): List<File>

    /** Download one Spotify pick: YouTube Music audio with Spotify's tags. */
    suspend fun downloadSpotify(
        pick: SpotifyPick,
        settings: AppSettings,
        outputDir: File,
        processId: String,
        onProgress: (EngineProgress) -> Unit,
    ): List<File>

    /** Stop a running [download]; partial files stay so a restart resumes. */
    fun stop(processId: String)

    suspend fun version(): String?

    suspend fun update(): UpdateResult
}

class StoppedException : Exception("Stopped")

data class UpdateResult(val version: String?, val updated: Boolean, val message: String)
