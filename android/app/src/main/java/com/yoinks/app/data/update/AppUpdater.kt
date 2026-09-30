package com.yoinks.app.data.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.yoinks.app.BuildConfig
import com.yoinks.app.domain.update.UpdateRules
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

data class AppUpdate(val version: String, val apkName: String, val apkUrl: String, val sizeBytes: Long, val pageUrl: String)

/**
 * Checks this repo's latest GitHub release, downloads the APK for this phone
 * and hands it to Android's installer. Android only installs it over the
 * current app when both are signed with the same key, so a tampered APK
 * cannot replace Yoinks.
 */
@Singleton
class AppUpdater @Inject constructor(
    @ApplicationContext private val context: Context,
    private val http: OkHttpClient,
    private val json: Json,
) {
    @Serializable
    private data class Release(
        @SerialName("tag_name") val tag: String,
        @SerialName("html_url") val page: String,
        val draft: Boolean = false,
        val prerelease: Boolean = false,
        val assets: List<Asset> = emptyList(),
    )

    @Serializable
    private data class Asset(val name: String, @SerialName("browser_download_url") val url: String, val size: Long = 0)

    private val dir get() = File(context.cacheDir, "updates")

    /** The newer release for this phone, or null (up to date, offline, no APK for it). */
    suspend fun check(): AppUpdate? = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(LATEST_RELEASE).header("Accept", "application/vnd.github+json").build()
        val release = http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return@withContext null
            json.decodeFromString<Release>(response.body.string())
        }
        if (release.draft || release.prerelease || !UpdateRules.isNewer(release.tag, BuildConfig.VERSION_NAME)) return@withContext null
        val name = UpdateRules.pickApk(release.assets.map { it.name }, Build.SUPPORTED_ABIS.toList()) ?: return@withContext null
        val asset = release.assets.first { it.name == name }
        if (!asset.url.startsWith(DOWNLOAD_PREFIX)) return@withContext null
        AppUpdate(release.tag.removePrefix("v"), asset.name, asset.url, asset.size, release.page)
    }

    /** Downloads the APK into the cache (replacing older ones); progress is 0..1 or null if unknown. */
    suspend fun download(update: AppUpdate, onProgress: (Float?) -> Unit): File = withContext(Dispatchers.IO) {
        dir.deleteRecursively()
        dir.mkdirs()
        val part = File(dir, "${update.apkName}.part")
        http.newCall(Request.Builder().url(update.apkUrl).build()).execute().use { response ->
            if (!response.isSuccessful) throw IOException("HTTP ${response.code}")
            val total = response.body.contentLength().takeIf { it > 0 } ?: update.sizeBytes.takeIf { it > 0 }
            response.body.byteStream().use { input ->
                part.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var done = 0L
                    while (true) {
                        ensureActive()
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        done += n
                        onProgress(total?.let { (done.toFloat() / it).coerceAtMost(1f) })
                    }
                }
            }
        }
        File(dir, update.apkName).also { part.renameTo(it) }
    }

    /** Android 8+ asks once per app before it may install APKs. */
    fun canInstall(): Boolean = context.packageManager.canRequestPackageInstalls()

    fun allowInstallsIntent(): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))

    fun installIntent(apk: File): Intent =
        Intent(Intent.ACTION_VIEW)
            .setDataAndType(FileProvider.getUriForFile(context, "${context.packageName}.updates", apk), "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)

    private companion object {
        const val REPO = "bliper2/yoinks-gui-fork"
        const val LATEST_RELEASE = "https://api.github.com/repos/$REPO/releases/latest"
        const val DOWNLOAD_PREFIX = "https://github.com/$REPO/releases/download/"
    }
}
