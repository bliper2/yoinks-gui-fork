package com.yoinks.app.service

import android.app.ForegroundServiceStartNotAllowedException
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.PowerManager
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.yoinks.app.data.queue.DownloadQueue
import dagger.hilt.android.AndroidEntryPoint
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.sample
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Keeps downloads running with the app closed or the screen off: a
 * foreground service (type dataSync) with a progress notification and
 * Pause/Cancel actions. It stops itself when nothing is left to do.
 * The downloads themselves run in [DownloadQueue].
 */
@OptIn(FlowPreview::class)
@AndroidEntryPoint
class DownloadService : LifecycleService() {
    @Inject lateinit var queue: DownloadQueue
    @Inject lateinit var notifications: DownloadNotifications

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        ServiceCompat.startForeground(
            this,
            DownloadNotifications.ONGOING_ID,
            notifications.progress(queue.jobs.value),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0,
        )
        wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Yoinks:downloads")
            .apply { setReferenceCounted(false) }

        lifecycleScope.launch {
            queue.jobs.sample(1000).collect { jobs ->
                if (jobs.none { it.phase.isActive || it.phase.isPending }) {
                    stopSelf()
                    return@collect
                }
                if (jobs.any { it.phase.isActive }) wakeLock?.acquire(WAKE_TIMEOUT_MS) else wakeLock?.release()
                // Updating our own foreground notification needs no extra permission.
                getSystemService(NotificationManager::class.java).notify(DownloadNotifications.ONGOING_ID, notifications.progress(jobs))
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_PAUSE_ALL -> queue.pauseAll()
            ACTION_CANCEL_ALL -> queue.cancelAll()
        }
        return START_NOT_STICKY
    }

    /** Android 15+: dataSync services get about 6 hours a day. Pause cleanly. */
    override fun onTimeout(startId: Int, fgsType: Int) {
        queue.pauseAll()
        stopSelf()
    }

    override fun onDestroy() {
        wakeLock?.release()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    companion object {
        const val ACTION_PAUSE_ALL = "com.yoinks.app.PAUSE_ALL"
        const val ACTION_CANCEL_ALL = "com.yoinks.app.CANCEL_ALL"
        private const val WAKE_TIMEOUT_MS = 60 * 60 * 1000L
    }
}

/** Starts [DownloadService]; called when downloads are added or resumed. */
@Singleton
class DownloadServiceLauncher @Inject constructor(@ApplicationContext private val context: Context) {
    fun start() {
        try {
            ContextCompat.startForegroundService(context, Intent(context, DownloadService::class.java))
        } catch (e: IllegalStateException) {
            // Android 12+ refuses when started from the background. The queue
            // still runs while the process lives; the next foreground start
            // brings the notification back.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && e is ForegroundServiceStartNotAllowedException) {
                Log.w("Yoinks", "Foreground service start not allowed from background", e)
            } else {
                throw e
            }
        }
    }
}
