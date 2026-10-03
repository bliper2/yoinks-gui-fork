package com.yoinks.app.data.health

import android.content.Context
import android.os.StatFs
import androidx.documentfile.provider.DocumentFile
import android.net.Uri
import com.yoinks.app.data.device.DeviceMonitor
import com.yoinks.app.data.settings.SettingsRepository
import com.yoinks.app.domain.engine.MediaEngine
import com.yoinks.app.domain.health.HealthItem
import com.yoinks.app.domain.health.HealthRules
import com.yoinks.app.domain.health.HealthStatus
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** Settings -> Health check: tests the parts Yoinks needs and says which one is broken. */
@Singleton
class HealthCheck @Inject constructor(
    @ApplicationContext private val context: Context,
    private val engine: MediaEngine,
    private val settingsRepo: SettingsRepository,
    private val device: DeviceMonitor,
    private val http: OkHttpClient,
) {
    suspend fun run(): List<HealthItem> = withContext(Dispatchers.IO) {
        val settings = settingsRepo.current()
        val items = mutableListOf<HealthItem>()

        val engineReady = runCatching { engine.ensureReady() }
        items += if (engineReady.isSuccess) {
            HealthRules.ytdlp(runCatching { engine.version() }.getOrNull(), settings.ytdlpAutoUpdate)
        } else {
            HealthItem("yt-dlp and ffmpeg", HealthStatus.FAIL, "The download engine could not start. Reinstall Yoinks.")
        }
        if (engineReady.isSuccess) items += HealthItem("ffmpeg", HealthStatus.OK, "Unpacked and ready.")

        items += folder("Video folder", settings.videoFolderUri, "Movies/Yoinks")
        items += folder("Music folder", settings.audioFolderUri, "Music/Yoinks")
        items += HealthRules.storage(runCatching { StatFs(context.filesDir.path).availableBytes }.getOrDefault(Long.MAX_VALUE))
        items += internet()
        items += HealthRules.battery(device.batteryPercent(), device.charging(), settings.pauseOnLowBattery)
        items
    }

    private fun folder(label: String, treeUri: String?, default: String): HealthItem {
        if (treeUri == null) return HealthItem(label, HealthStatus.OK, "$default (the default).")
        val dir = runCatching { DocumentFile.fromTreeUri(context, Uri.parse(treeUri)) }.getOrNull()
        return if (dir?.canWrite() == true) HealthItem(label, HealthStatus.OK, "${dir.name ?: "Chosen folder"}: writable.")
        else HealthItem(label, HealthStatus.FAIL, "Yoinks can no longer write to the chosen folder. Pick it again in Settings.")
    }

    private fun internet(): HealthItem = try {
        val client = http.newBuilder().callTimeout(6, TimeUnit.SECONDS).build()
        client.newCall(Request.Builder().url("https://www.youtube.com/generate_204").build()).execute().use { response ->
            if (response.code == 204 || response.isSuccessful) HealthItem("Internet", HealthStatus.OK, "Connected.")
            else HealthItem("Internet", HealthStatus.WARN, "YouTube answered with error ${response.code}.")
        }
    } catch (e: Exception) {
        HealthItem("Internet", HealthStatus.FAIL, "Could not reach YouTube. Check your connection, VPN or Private DNS.")
    }
}
