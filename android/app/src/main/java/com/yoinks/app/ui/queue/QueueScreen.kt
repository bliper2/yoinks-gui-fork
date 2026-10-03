package com.yoinks.app.ui.queue

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DeleteSweep
import androidx.compose.material.icons.rounded.Downloading
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.PreviewScreenSizes
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import com.yoinks.app.data.queue.DownloadQueue
import com.yoinks.app.domain.model.DownloadJob
import com.yoinks.app.domain.model.JobPhase
import com.yoinks.app.domain.model.MediaKind
import com.yoinks.app.ui.components.Chip
import com.yoinks.app.ui.components.EmptyState
import com.yoinks.app.ui.components.IconAction
import com.yoinks.app.ui.components.Thumbnail
import com.yoinks.app.ui.format.Formatters
import com.yoinks.app.ui.preview.PreviewData
import com.yoinks.app.ui.theme.YoinksTheme
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import com.yoinks.app.BuildConfig
import com.yoinks.app.domain.engine.MediaEngine
import com.yoinks.app.domain.support.DebugReport
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class QueueViewModel @Inject constructor(val queue: DownloadQueue, private val engine: MediaEngine) : ViewModel() {
    /** The report behind "Copy details" for a failed download. */
    suspend fun debugReport(job: DownloadJob): String = DebugReport.build(
        appVersion = BuildConfig.VERSION_NAME,
        device = "Android ${android.os.Build.VERSION.RELEASE} (SDK ${android.os.Build.VERSION.SDK_INT}), ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}",
        ytdlpVersion = runCatching { engine.version() }.getOrNull(),
        url = job.request.url,
        code = job.error?.code ?: "unknown",
        message = job.error?.message ?: "no message",
        detail = job.error?.detail.orEmpty(),
    )
}

/** Callbacks for queue rows. */
class QueueActions(
    val pause: (String) -> Unit,
    val resume: (String) -> Unit,
    val cancel: (String) -> Unit,
    val retry: (String) -> Unit,
    val pauseAll: () -> Unit,
    val resumeAll: () -> Unit,
    val clearFailed: () -> Unit,
    val select: (DownloadJob) -> Unit,
    val copyDetails: (DownloadJob) -> Unit = {},
)

@Composable
fun rememberQueueActions(vm: QueueViewModel, onSelect: (DownloadJob) -> Unit): QueueActions {
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    return QueueActions(
        vm.queue::pause, vm.queue::resume, vm.queue::cancel, vm.queue::retry,
        vm.queue::pauseAll, vm.queue::resumeAll, vm.queue::clearFailed, onSelect,
        copyDetails = { job -> scope.launch { clipboard.setText(AnnotatedString(vm.debugReport(job))) } },
    )
}

@Composable
fun QueueRoute(onSelect: (DownloadJob) -> Unit, selectedId: String? = null, vm: QueueViewModel = hiltViewModel()) {
    val jobs by vm.queue.jobs.collectAsState()
    QueueScreen(jobs, rememberQueueActions(vm, onSelect), selectedId)
}

@Composable
fun QueueScreen(jobs: List<DownloadJob>, actions: QueueActions, selectedId: String? = null, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize()) {
        FlowRow(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            val active = jobs.count { it.phase.isActive }
            Text(
                if (jobs.isEmpty()) "Queue" else "Queue · $active active · ${jobs.size} total",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.align(Alignment.CenterVertically).weight(1f),
            )
            IconAction(Icons.Rounded.Pause, "Pause all", actions.pauseAll, enabled = jobs.any { it.phase.isActive || it.phase.isPending })
            IconAction(Icons.Rounded.PlayArrow, "Resume all", actions.resumeAll, enabled = jobs.any { it.phase == JobPhase.PAUSED })
            IconAction(Icons.Rounded.DeleteSweep, "Remove failed", actions.clearFailed, enabled = jobs.any { it.phase == JobPhase.FAILED })
        }
        if (jobs.isEmpty()) {
            EmptyState(Icons.Rounded.Downloading, "No downloads running", "Share a link to Yoinks or paste one on the Home screen.")
            return@Column
        }
        LazyColumn(contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(jobs, key = { it.id }) { job -> JobCard(job, actions, selected = job.id == selectedId) }
        }
    }
}

/** "42% · 2.1MiB/s · 0:12 left" or the job's status/error. */
fun statusLine(job: DownloadJob): String {
    job.error?.takeIf { job.phase == JobPhase.FAILED }?.let { return it.message }
    val p = job.progress
    return when (job.phase) {
        JobPhase.QUEUED -> job.status ?: "Waiting…"
        JobPhase.WAITING_FOR_NETWORK -> job.status ?: "Waiting for a connection"
        JobPhase.PREPARING, JobPhase.SAVING -> job.status ?: "Working…"
        JobPhase.PAUSED -> job.status ?: "Paused"
        JobPhase.PROCESSING -> listOfNotNull(p?.item?.let { "${it.index}/${it.count}" }, if (job.request.kind == MediaKind.AUDIO) "Converting…" else "Finishing…").joinToString(" · ")
        JobPhase.DOWNLOADING -> listOfNotNull(
            p?.item?.let { "${it.index}/${it.count}" },
            p?.fraction?.let { "${(it * 100).toInt()}%" },
            p?.speed,
            p?.etaSeconds?.let { "${Formatters.duration(it)} left" },
        ).joinToString(" · ").ifEmpty { "Starting…" }
        JobPhase.FAILED -> "Failed"
    }
}

@Composable
private fun JobCard(job: DownloadJob, actions: QueueActions, selected: Boolean) {
    val failed = job.phase == JobPhase.FAILED
    Card(
        onClick = { actions.select(job) },
        colors = CardDefaults.cardColors(
            containerColor = when {
                selected -> MaterialTheme.colorScheme.secondaryContainer
                failed -> MaterialTheme.colorScheme.errorContainer
                else -> MaterialTheme.colorScheme.surfaceContainerHigh
            },
        ),
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = false) { contentDescription = "${job.title}, ${statusLine(job)}" },
    ) {
        Column(Modifier.padding(start = 12.dp, top = 8.dp, bottom = 12.dp, end = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Thumbnail(job.request.thumbnail, job.request.kind == MediaKind.AUDIO, 44.dp)
                Column(Modifier.weight(1f)) {
                    Text(job.title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Chip(job.platform.displayName)
                        Chip(formatLabel(job))
                    }
                }
                JobButtons(job, actions)
            }
            if (!failed && job.phase != JobPhase.PAUSED) {
                val fraction = job.progress?.fraction
                val overall = job.progress?.item?.let { item -> ((item.index - 1) + (fraction ?: 0f)) / item.count } ?: fraction
                if (overall == null || job.phase == JobPhase.PREPARING) LinearProgressIndicator(Modifier.fillMaxWidth().padding(end = 8.dp))
                else LinearProgressIndicator(progress = { overall }, modifier = Modifier.fillMaxWidth().padding(end = 8.dp))
            }
            Text(
                statusLine(job),
                style = MaterialTheme.typography.bodySmall,
                color = if (failed) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

fun formatLabel(job: DownloadJob): String = buildString {
    append(
        when {
            job.request.spotify != null -> "Spotify → audio"
            job.request.format == "audio" -> "Audio"
            job.request.format == "best" -> "Best"
            else -> "${job.request.format}p"
        },
    )
    if (job.request.clip != null) append(" · clip")
    if (job.request.playlist) append(" · playlist")
}

@Composable
private fun JobButtons(job: DownloadJob, actions: QueueActions) {
    Row {
        when (job.phase) {
            JobPhase.PAUSED -> IconAction(Icons.Rounded.PlayArrow, "Resume ${job.title}", { actions.resume(job.id) })
            // Even "permanent" errors can be retried, e.g. after importing cookies.
            JobPhase.FAILED -> {
                IconAction(Icons.Rounded.Refresh, "Retry ${job.title}", { actions.retry(job.id) })
                IconAction(Icons.Rounded.ContentCopy, "Copy details for support", { actions.copyDetails(job) })
            }
            JobPhase.SAVING -> Unit
            else -> IconAction(Icons.Rounded.Pause, "Pause ${job.title}", { actions.pause(job.id) })
        }
        IconAction(Icons.Rounded.Close, if (job.phase == JobPhase.FAILED || job.phase == JobPhase.PAUSED) "Remove ${job.title}" else "Cancel ${job.title}", { actions.cancel(job.id) })
    }
}

/** Right-hand pane on tablets: everything about one job. */
@Composable
fun JobDetail(job: DownloadJob?, actions: QueueActions, modifier: Modifier = Modifier) {
    if (job == null) {
        EmptyState(Icons.Rounded.Downloading, "Pick a download", "Select a download on the left to see its details.", modifier)
        return
    }
    Column(modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Thumbnail(job.request.thumbnail, job.request.kind == MediaKind.AUDIO, 160.dp)
        Text(job.title, style = MaterialTheme.typography.headlineSmall)
        Text(job.request.url, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Chip(job.platform.displayName)
            Chip(formatLabel(job))
        }
        Text(statusLine(job), style = MaterialTheme.typography.bodyLarge)
        job.error?.detail?.takeIf { it.isNotBlank() }?.let {
            Surface(color = MaterialTheme.colorScheme.surfaceContainerHighest, shape = MaterialTheme.shapes.small) {
                Text("yt-dlp said: $it", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(12.dp))
            }
        }
        Row(Modifier.heightIn(min = 48.dp)) { JobButtons(job, actions) }
    }
}

private val previewActions = QueueActions({}, {}, {}, {}, {}, {}, {}, {})

@PreviewScreenSizes
@Composable
internal fun QueuePreview() = YoinksTheme { Surface { QueueScreen(PreviewData.jobs, previewActions) } }
