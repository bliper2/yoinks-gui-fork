package com.yoinks.app

import android.app.Application
import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
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
        // Long-press the app icon: "Paste link" (downloads what is on the clipboard).
        ShortcutManagerCompat.setDynamicShortcuts(
            this,
            listOf(
                ShortcutInfoCompat.Builder(this, "paste")
                    .setShortLabel(getString(R.string.shortcut_paste))
                    .setLongLabel(getString(R.string.shortcut_paste_long))
                    .setIcon(IconCompat.createWithResource(this, R.mipmap.ic_launcher))
                    .setIntent(Intent(this, MainActivity::class.java).setAction(MainActivity.ACTION_PASTE))
                    .build(),
            ),
        )
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
