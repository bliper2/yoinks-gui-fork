package com.yoinks.app.data.queue

import android.content.Context
import com.yoinks.app.data.history.HistoryRepository
import com.yoinks.app.data.network.NetworkMonitor
import com.yoinks.app.data.settings.SettingsRepository
import com.yoinks.app.data.spotify.SpotifyRepository
import com.yoinks.app.data.storage.MediaSaver
import com.yoinks.app.domain.engine.MediaEngine
import com.yoinks.app.domain.errors.ErrorTranslator
import com.yoinks.app.domain.model.DownloadJob
import com.yoinks.app.domain.model.DownloadRequest
import com.yoinks.app.domain.model.EngineProgress
import com.yoinks.app.domain.model.ItemProgress
import com.yoinks.app.domain.model.JobPhase
import com.yoinks.app.domain.model.Platform
import com.yoinks.app.domain.model.YoinksError
import com.yoinks.app.domain.model.YoinksException
import com.yoinks.app.service.DownloadNotifications
import com.yoinks.app.service.DownloadServiceLauncher
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The download queue: runs up to N jobs at once (setting), waits for the
 * network / Wi-Fi, retries network errors with backoff, and pauses by
 * stopping yt-dlp while keeping partial files (resuming continues them).
 * Finished jobs leave the queue and go to history.
 */
@Singleton
class DownloadQueue @Inject constructor(
    @ApplicationContext private val context: Context,
    private val engine: MediaEngine,
    private val saver: MediaSaver,
    private val history: HistoryRepository,
    private val settingsRepo: SettingsRepository,
    private val spotify: SpotifyRepository,
    private val network: NetworkMonitor,
    private val notifier: DownloadNotifications,
    private val launcher: DownloadServiceLauncher,
    private val json: Json,
    private val appScope: CoroutineScope,
) {
    private enum class StopReason { PAUSE, CANCEL }

    private val _jobs = MutableStateFlow(restore())
    val jobs: StateFlow<List<DownloadJob>> = _jobs.asStateFlow()

    private val running = ConcurrentHashMap<String, Job>()
    private val stopReasons = ConcurrentHashMap<String, StopReason>()

    init {
        appScope.launch { combine(settingsRepo.settings, network.state) { _, _ -> }.collect { pump() } }
    }

    // ---------- commands ----------

    fun enqueue(requests: List<DownloadRequest>) {
        if (requests.isEmpty()) return
        _jobs.update { list -> list + requests.map { DownloadJob(UUID.randomUUID().toString(), it, Platform.detect(it.url)) } }
        persist()
        launcher.start()
        pump()
    }

    fun pause(id: String) {
        val job = find(id) ?: return
        when {
            job.phase.isPending -> setPhase(id, JobPhase.PAUSED)
            job.phase == JobPhase.SAVING -> Unit // almost done; let it finish
            job.phase.isActive -> stop(id, StopReason.PAUSE)
        }
    }

    fun resume(id: String) {
        if (find(id)?.phase != JobPhase.PAUSED) return
        _jobs.update { list -> list.map { if (it.id == id) it.copy(phase = JobPhase.QUEUED, status = null, retryAtMillis = 0) else it } }
        persist()
        launcher.start()
        pump()
    }

    fun retry(id: String) {
        if (find(id)?.phase != JobPhase.FAILED) return
        _jobs.update { list -> list.map { if (it.id == id) it.copy(phase = JobPhase.QUEUED, attempts = 0, error = null, status = null, retryAtMillis = 0) else it } }
        launcher.start()
        pump()
    }

    /** Cancel a running/pending job, or remove a paused/failed one. */
    fun cancel(id: String) {
        val job = find(id) ?: return
        if (running.containsKey(id)) {
            stop(id, StopReason.CANCEL)
        } else {
            removeJob(job.id)
            tempDir(job.id).deleteRecursively()
        }
    }

    fun pauseAll() = jobs.value.forEach { pause(it.id) }
    fun resumeAll() = jobs.value.filter { it.phase == JobPhase.PAUSED }.forEach { resume(it.id) }
    fun cancelAll() = jobs.value.forEach { cancel(it.id) }
    fun clearFailed() = jobs.value.filter { it.phase == JobPhase.FAILED }.forEach { cancel(it.id) }

    private fun stop(id: String, reason: StopReason) {
        stopReasons[id] = reason
        engine.stop(id) // kills yt-dlp if it is running
        running[id]?.cancel() // and stops any other step
    }

    // ---------- scheduling ----------

    @Synchronized
    private fun pump() {
        val settings = settingsRepo.settings.value
        val net = network.state.value
        val now = System.currentTimeMillis()
        var active = running.size
        val waitingText = when {
            !net.online -> "Waiting for a connection"
            settings.wifiOnly && !net.unmetered -> "Waiting for Wi-Fi"
            else -> null
        }
        for (job in jobs.value.filter { it.phase.isPending }.sortedBy { it.createdAt }) {
            if (waitingText != null) {
                if (job.phase != JobPhase.WAITING_FOR_NETWORK || job.status != waitingText) setPhase(job.id, JobPhase.WAITING_FOR_NETWORK, waitingText)
                continue
            }
            if (job.phase == JobPhase.WAITING_FOR_NETWORK) setPhase(job.id, JobPhase.QUEUED)
            if (job.retryAtMillis > now || active >= settings.concurrency) continue
            start(job)
            active++
        }
    }

    private fun start(job: DownloadJob) {
        update(job.id) { it.copy(phase = JobPhase.PREPARING, status = "Starting…", error = null, progress = null) }
        // Registered before it starts: a job that fails instantly must not be
        // removed from `running` before it was added (a slot would leak forever).
        val task = appScope.launch(Dispatchers.IO, start = CoroutineStart.LAZY) { run(job) }
        running[job.id] = task
        task.start()
    }

    private suspend fun run(job: DownloadJob) {
        val dir = tempDir(job.id)
        try {
            val settings = settingsRepo.current()
            engine.ensureReady()
            val onProgress = { p: EngineProgress ->
                update(job.id) { it.copy(phase = if (p.processing) JobPhase.PROCESSING else JobPhase.DOWNLOADING, progress = p, status = null) }
            }
            val picks = job.request.spotify
            val files = if (picks != null) {
                var firstFailure: YoinksException? = null
                val done = picks.flatMapIndexed { n, pick ->
                    val itemProgress = { p: EngineProgress -> onProgress(p.copy(item = ItemProgress(n + 1, picks.size))) }
                    val detailed = if (pick.cover == null) spotify.trackDetails(pick.track.id).let { (cover, year) -> pick.copy(cover = cover, year = pick.year ?: year) } else pick
                    runCatching { engine.downloadSpotify(detailed, settings, dir, job.id, itemProgress) }
                        .onFailure { if (it !is YoinksException) throw it else if (firstFailure == null) firstFailure = it } // stop/cancel propagate; one bad song doesn't
                        .getOrDefault(emptyList())
                }.distinct()
                // Every song failed: show why, not "no file was produced".
                if (done.isEmpty()) firstFailure?.let { throw it }
                done
            } else {
                engine.download(job.request, settings, dir, job.id, onProgress)
            }
            if (files.isEmpty()) throw YoinksException(YoinksError("nofile", "The download finished but no file was produced. Try another format.", true))
            update(job.id) { it.copy(phase = JobPhase.SAVING, status = "Saving…") }
            val saved = saver.save(files, dir, settings)
            history.add(job.request, job.platform, saved)
            removeJob(job.id)
            dir.deleteRecursively()
            if (settings.notifications) notifier.completed(job, saved)
        } catch (e: Throwable) {
            when (stopReasons.remove(job.id)) {
                StopReason.PAUSE -> setPhase(job.id, JobPhase.PAUSED) // keep partial files
                StopReason.CANCEL -> {
                    removeJob(job.id)
                    dir.deleteRecursively()
                }
                null -> fail(job, ErrorTranslator.translate(e, job.platform))
            }
        } finally {
            running.remove(job.id)
            pump()
        }
    }

    private fun fail(job: DownloadJob, error: YoinksError) {
        val settings = settingsRepo.settings.value
        val attempts = (find(job.id)?.attempts ?: 0) + 1
        if (error.retryable && attempts <= settings.retries) {
            val wait = 5_000L * attempts
            update(job.id) {
                it.copy(phase = JobPhase.QUEUED, attempts = attempts, error = error, retryAtMillis = System.currentTimeMillis() + wait, status = "Retrying (${attempts}/${settings.retries})…")
            }
            appScope.launch {
                delay(wait + 100)
                pump()
            }
        } else {
            update(job.id) { it.copy(phase = JobPhase.FAILED, attempts = attempts, error = error, status = null, progress = null) }
            if (settings.notifications) notifier.failed(job, error)
        }
    }

    // ---------- state helpers ----------

    private fun find(id: String) = jobs.value.firstOrNull { it.id == id }

    private fun update(id: String, change: (DownloadJob) -> DownloadJob) {
        _jobs.update { list -> list.map { if (it.id == id) change(it) else it } }
    }

    private fun setPhase(id: String, phase: JobPhase, status: String? = null) {
        update(id) { it.copy(phase = phase, status = status) }
        if (phase == JobPhase.PAUSED) persist()
    }

    private fun removeJob(id: String) {
        _jobs.update { list -> list.filterNot { it.id == id } }
        persist()
    }

    private fun tempDir(id: String) = File(context.filesDir, "downloads/$id")

    // ---------- persistence ----------
    // Unfinished jobs survive the app being killed; they come back paused so
    // nothing starts downloading by surprise. Partial files are kept.

    @Serializable
    private data class Saved(val id: String, val request: DownloadRequest, val createdAt: Long)

    private val stateFile get() = File(context.filesDir, "queue.json")

    private fun persist() {
        val saved = jobs.value.map { Saved(it.id, it.request, it.createdAt) }
        runCatching { stateFile.writeText(json.encodeToString(ListSerializer(Saved.serializer()), saved)) }
    }

    private fun restore(): List<DownloadJob> {
        val saved = runCatching {
            json.decodeFromString(ListSerializer(Saved.serializer()), stateFile.readText())
        }.getOrDefault(emptyList())
        // Temp folders of jobs that no longer exist are leftovers: remove them.
        val keep = saved.map { it.id }.toSet()
        File(context.filesDir, "downloads").listFiles()?.filter { it.name !in keep }?.forEach { it.deleteRecursively() }
        return saved.map { DownloadJob(it.id, it.request, Platform.detect(it.request.url), phase = JobPhase.PAUSED, status = "Paused (app was closed)", createdAt = it.createdAt) }
    }
}
