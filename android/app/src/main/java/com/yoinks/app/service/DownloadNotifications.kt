package com.yoinks.app.service

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.yoinks.app.MainActivity
import com.yoinks.app.R
import com.yoinks.app.data.storage.SavedFile
import com.yoinks.app.domain.model.DownloadJob
import com.yoinks.app.domain.model.JobPhase
import com.yoinks.app.domain.model.YoinksError
import com.yoinks.app.ui.format.Formatters
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** All notifications: the ongoing progress one and finished/failed results. */
@Singleton
class DownloadNotifications @Inject constructor(@ApplicationContext private val context: Context, private val http: OkHttpClient) {
    private val manager = NotificationManagerCompat.from(context)

    fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val system = context.getSystemService(NotificationManager::class.java)
        system.createNotificationChannel(
            NotificationChannel(CHANNEL_PROGRESS, context.getString(R.string.channel_progress), NotificationManager.IMPORTANCE_LOW).apply {
                description = context.getString(R.string.channel_progress_desc)
                setShowBadge(false)
            },
        )
        system.createNotificationChannel(
            NotificationChannel(CHANNEL_RESULTS, context.getString(R.string.channel_results), NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = context.getString(R.string.channel_results_desc)
            },
        )
    }

    /** The foreground-service notification summarising the queue. */
    fun progress(jobs: List<DownloadJob>): Notification {
        val active = jobs.filter { it.phase.isActive }
        val waiting = jobs.count { it.phase.isPending }
        val first = active.firstOrNull()
        val title = when {
            active.size > 1 -> context.getString(R.string.notif_downloading_many, active.size)
            first != null -> first.title
            waiting > 0 -> context.getString(R.string.notif_waiting, waiting)
            else -> context.getString(R.string.notif_preparing)
        }
        val fraction = first?.progress?.fraction
        val text = first?.let { job ->
            val p = job.progress
            listOfNotNull(
                job.status,
                p?.item?.let { "${it.index}/${it.count}" },
                if (p?.processing == true) context.getString(R.string.status_processing) else null,
                p?.fraction?.let { "${(it * 100).toInt()}%" },
                p?.speed,
                p?.etaSeconds?.let { context.getString(R.string.eta_left, Formatters.duration(it)) },
            ).joinToString(" · ")
        } ?: jobs.firstOrNull { it.phase == JobPhase.WAITING_FOR_NETWORK }?.status.orEmpty()

        return NotificationCompat.Builder(context, CHANNEL_PROGRESS)
            .setSmallIcon(R.drawable.ic_stat_yoinks)
            .setContentTitle(title)
            .setContentText(text)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setProgress(100, ((fraction ?: 0f) * 100).toInt(), first != null && fraction == null)
            .setContentIntent(openApp(MainActivity.DEST_QUEUE))
            .addAction(0, context.getString(R.string.action_pause_all), serviceAction(DownloadService.ACTION_PAUSE_ALL))
            .addAction(0, context.getString(R.string.action_cancel_all), serviceAction(DownloadService.ACTION_CANCEL_ALL))
            .build()
    }

    suspend fun completed(job: DownloadJob, saved: List<SavedFile>) {
        if (!allowed()) return
        val first = saved.firstOrNull() ?: return
        val picture = job.request.thumbnail?.let { loadThumbnail(it) }
        val open = Intent(Intent.ACTION_VIEW).setDataAndType(first.uri, first.mimeType).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        val tap = PendingIntent.getActivity(context, job.id.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val text = if (saved.size > 1) context.getString(R.string.notif_saved_many, saved.size, first.location) else first.location
        val builder = NotificationCompat.Builder(context, CHANNEL_RESULTS)
            .setSmallIcon(R.drawable.ic_stat_yoinks)
            .setContentTitle(context.getString(R.string.notif_done, job.title))
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(tap)
        if (picture != null) {
            builder.setLargeIcon(picture)
            builder.setStyle(NotificationCompat.BigPictureStyle().bigPicture(picture).bigLargeIcon(null as Bitmap?))
        }
        if (saved.size == 1) {
            // "Share" hands the saved file to any app (a chat, a mail, a cloud drive).
            val send = Intent(Intent.ACTION_SEND).setType(first.mimeType).putExtra(Intent.EXTRA_STREAM, first.uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val chooser = Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            builder.addAction(0, context.getString(R.string.action_share_file), PendingIntent.getActivity(context, job.id.hashCode() + 1, chooser, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        }
        notify(job.id.hashCode(), builder.build())
    }

    /** The video's picture for the notification (small, and given up on after a few seconds). */
    private suspend fun loadThumbnail(url: String): Bitmap? = withContext(Dispatchers.IO) {
        runCatching {
            val client = http.newBuilder().callTimeout(6, TimeUnit.SECONDS).build()
            client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                val body = response.body
                if (!response.isSuccessful || body.contentLength() > MAX_THUMBNAIL_BYTES) return@use null
                val bytes = body.bytes()
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                var sample = 1
                while (bounds.outWidth / (sample * 2) >= 512) sample *= 2
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            }
        }.getOrNull()
    }

    fun failed(job: DownloadJob, error: YoinksError) {
        if (!allowed()) return
        notify(
            job.id.hashCode(),
            NotificationCompat.Builder(context, CHANNEL_RESULTS)
                .setSmallIcon(R.drawable.ic_stat_yoinks)
                .setContentTitle(context.getString(R.string.notif_failed, job.title))
                .setContentText(error.message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(error.message))
                .setAutoCancel(true)
                .setContentIntent(openApp(MainActivity.DEST_QUEUE))
                .build(),
        )
    }

    private fun allowed(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    @Suppress("MissingPermission") // checked in allowed()
    private fun notify(id: Int, notification: Notification) = manager.notify(id, notification)

    private fun openApp(destination: String): PendingIntent =
        PendingIntent.getActivity(
            context,
            destination.hashCode(),
            Intent(context, MainActivity::class.java).putExtra(MainActivity.EXTRA_DESTINATION, destination).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    private fun serviceAction(action: String): PendingIntent =
        PendingIntent.getService(context, action.hashCode(), Intent(context, DownloadService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE)

    companion object {
        const val CHANNEL_PROGRESS = "downloads"
        const val CHANNEL_RESULTS = "results"
        const val ONGOING_ID = 1
        private const val MAX_THUMBNAIL_BYTES = 4L * 1024 * 1024
    }
}
