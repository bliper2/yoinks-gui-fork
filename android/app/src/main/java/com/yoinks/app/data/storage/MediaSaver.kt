package com.yoinks.app.data.storage

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.documentfile.provider.DocumentFile
import com.yoinks.app.domain.model.AppSettings
import com.yoinks.app.domain.model.YoinksError
import com.yoinks.app.domain.model.YoinksException
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

data class SavedFile(val uri: Uri, val displayName: String, val mimeType: String, val sizeBytes: Long, val location: String)

/**
 * Moves finished downloads from app-private storage to where people find
 * them: MediaStore (Movies/Yoinks, Music/Yoinks, Pictures/Yoinks) so they
 * show up in Gallery and music apps, or a folder picked in Settings (SAF).
 * No broad storage permission on Android 10+; Android 8–9 needs the
 * legacy write permission (requested in the UI) for public folders.
 */
@Singleton
class MediaSaver @Inject constructor(@ApplicationContext private val context: Context) {

    suspend fun save(files: List<File>, baseDir: File, settings: AppSettings): List<SavedFile> = withContext(Dispatchers.IO) {
        files.map { file ->
            val mime = mimeOf(file)
            val kind = kindOf(mime)
            // Keep the playlist sub-folder yt-dlp created, if any.
            val sub = file.parentFile?.relativeTo(baseDir)?.path?.replace('\\', '/')?.takeIf { it.isNotEmpty() && it != "." }
            val tree = when (kind) {
                Kind.AUDIO -> settings.audioFolderUri
                Kind.VIDEO, Kind.IMAGE, Kind.OTHER -> settings.videoFolderUri
            }
            try {
                when {
                    tree != null -> saveToTree(file, Uri.parse(tree), sub, mime)
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> saveToMediaStore(file, kind, sub, mime)
                    else -> saveLegacy(file, kind, sub, mime)
                }
            } catch (e: SecurityException) {
                throw YoinksException(YoinksError("folder", "Yoinks can no longer write to the chosen folder. Pick the folder again in Settings.", false, e.message.orEmpty()), e)
            } catch (e: java.io.IOException) {
                throw YoinksException(YoinksError("disk", "Could not save the file. Check that your phone has free space.", false, e.message.orEmpty()), e)
            }
        }
    }

    private enum class Kind { VIDEO, AUDIO, IMAGE, OTHER }

    private fun kindOf(mime: String) = when {
        mime.startsWith("audio/") -> Kind.AUDIO
        mime.startsWith("video/") -> Kind.VIDEO
        mime.startsWith("image/") -> Kind.IMAGE
        else -> Kind.OTHER
    }

    private fun mimeOf(file: File): String {
        val ext = file.extension.lowercase()
        return when (ext) {
            "opus" -> "audio/ogg"
            "m4a" -> "audio/mp4"
            "mkv" -> "video/x-matroska"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
        }
    }

    private fun publicDir(kind: Kind) = when (kind) {
        Kind.AUDIO -> Environment.DIRECTORY_MUSIC
        Kind.VIDEO -> Environment.DIRECTORY_MOVIES
        Kind.IMAGE -> Environment.DIRECTORY_PICTURES
        Kind.OTHER -> Environment.DIRECTORY_DOWNLOADS
    }

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.Q)
    private fun saveToMediaStore(file: File, kind: Kind, sub: String?, mime: String): SavedFile {
        val resolver = context.contentResolver
        val collection = when (kind) {
            Kind.AUDIO -> MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            Kind.VIDEO -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            Kind.IMAGE -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            Kind.OTHER -> MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        }
        val relative = listOfNotNull(publicDir(kind), "Yoinks", sub).joinToString("/")
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, relative)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(collection, values) ?: throw java.io.IOException("MediaStore refused the file")
        try {
            resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } } ?: throw java.io.IOException("Cannot open output")
            resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
        return SavedFile(uri, file.name, mime, file.length(), relative)
    }

    private fun saveToTree(file: File, treeUri: Uri, sub: String?, mime: String): SavedFile {
        var dir = DocumentFile.fromTreeUri(context, treeUri) ?: throw SecurityException("Folder not accessible")
        if (!dir.canWrite()) throw SecurityException("Folder not writable")
        sub?.split('/')?.filter { it.isNotBlank() }?.forEach { part ->
            dir = dir.findFile(part)?.takeIf { it.isDirectory } ?: dir.createDirectory(part) ?: throw java.io.IOException("Cannot create folder $part")
        }
        val target = dir.createFile(mime, file.nameWithoutExtension) ?: throw java.io.IOException("Cannot create file")
        context.contentResolver.openOutputStream(target.uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
            ?: throw java.io.IOException("Cannot open output")
        val location = listOfNotNull(dir.name, sub).joinToString("/")
        return SavedFile(target.uri, target.name ?: file.name, mime, file.length(), location)
    }

    @Suppress("DEPRECATION")
    private suspend fun saveLegacy(file: File, kind: Kind, sub: String?, mime: String): SavedFile {
        val root = File(Environment.getExternalStoragePublicDirectory(publicDir(kind)), "Yoinks")
        val dir = if (sub != null) File(root, sub) else root
        if (!dir.exists() && !dir.mkdirs()) throw SecurityException("Storage permission missing")
        var target = File(dir, file.name)
        var n = 1
        while (target.exists()) target = File(dir, "${file.nameWithoutExtension} ($n).${file.extension}").also { n++ }
        file.copyTo(target)
        val uri = suspendCancellableCoroutine { cont ->
            MediaScannerConnection.scanFile(context, arrayOf(target.absolutePath), arrayOf(mime)) { _, scanned -> cont.resume(scanned) }
        } ?: Uri.fromFile(target)
        return SavedFile(uri, target.name, mime, target.length(), dir.absolutePath.substringAfter("/0/"))
    }
}
