package com.yoinks.app.work

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.yoinks.app.domain.engine.MediaEngine
import com.yoinks.app.domain.model.AppSettings
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** Keeps yt-dlp current: sites change often and old versions stop working. */
@HiltWorker
class YtDlpUpdateWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val engine: MediaEngine,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = try {
        engine.update()
        Result.success()
    } catch (e: Exception) {
        if (runAttemptCount < 3) Result.retry() else Result.failure()
    }
}

@Singleton
class UpdateScheduler @Inject constructor(@ApplicationContext private val context: Context) {
    /** (Re)schedule or cancel the background update to match the settings. */
    fun apply(settings: AppSettings) {
        val work = WorkManager.getInstance(context)
        if (!settings.ytdlpAutoUpdate) {
            work.cancelUniqueWork(NAME)
            return
        }
        val request = PeriodicWorkRequestBuilder<YtDlpUpdateWorker>(settings.ytdlpUpdateDays.toLong(), TimeUnit.DAYS)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(if (settings.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                    .setRequiresBatteryNotLow(true)
                    .build(),
            )
            .build()
        work.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    private companion object {
        const val NAME = "ytdlp-update"
    }
}
