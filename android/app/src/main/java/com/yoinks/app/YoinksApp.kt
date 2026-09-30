package com.yoinks.app

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.yoinks.app.data.settings.SettingsRepository
import com.yoinks.app.domain.engine.MediaEngine
import com.yoinks.app.service.DownloadNotifications
import com.yoinks.app.work.UpdateScheduler
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
class YoinksApp : Application(), Configuration.Provider {
    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var notifications: DownloadNotifications
    @Inject lateinit var settings: SettingsRepository
    @Inject lateinit var updates: UpdateScheduler
    @Inject lateinit var engine: MediaEngine
    @Inject lateinit var appScope: CoroutineScope

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        notifications.createChannels()
        appScope.launch {
            // Unpack yt-dlp early so the first share is fast.
            runCatching { engine.ensureReady() }
        }
        appScope.launch {
            settings.settings
                .map { Triple(it.ytdlpAutoUpdate, it.ytdlpUpdateDays, it.wifiOnly) }
                .distinctUntilChanged()
                .collect { updates.apply(settings.settings.value) }
        }
    }
}
