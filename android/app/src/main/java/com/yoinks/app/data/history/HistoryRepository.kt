package com.yoinks.app.data.history

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import com.yoinks.app.data.storage.SavedFile
import com.yoinks.app.domain.model.DownloadRequest
import com.yoinks.app.domain.model.Platform
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class HistoryRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val dao: HistoryDao,
) {
    val all: Flow<List<HistoryEntity>> = dao.observeAll()
    fun recent(limit: Int = 5): Flow<List<HistoryEntity>> = dao.observeRecent(limit)

    suspend fun add(request: DownloadRequest, platform: Platform, saved: List<SavedFile>) {
        val now = System.currentTimeMillis()
        dao.insertAll(
            saved.map {
                HistoryEntity(
                    // Instant/batch downloads have no title yet: use the file name.
                    title = if (saved.size == 1 && request.title.isNotBlank()) request.title else it.displayName.substringBeforeLast('.'),
                    sourceUrl = request.url,
                    contentUri = it.uri.toString(),
                    displayName = it.displayName,
                    mimeType = it.mimeType,
                    sizeBytes = it.sizeBytes,
                    platform = platform.name,
                    isAudio = it.mimeType.startsWith("audio/"),
                    thumbnail = request.thumbnail,
                    location = it.location,
                    format = request.format,
                    createdAt = now,
                )
            },
        )
    }

    /** Remove the entry; with [deleteFile] also delete the file (files Yoinks saved). */
    suspend fun delete(item: HistoryEntity, deleteFile: Boolean): Boolean = withContext(Dispatchers.IO) {
        val deleted = if (deleteFile) {
            val uri = Uri.parse(item.contentUri)
            runCatching {
                // Files in a picked folder are documents; MediaStore files are rows.
                if (DocumentsContract.isDocumentUri(context, uri)) DocumentsContract.deleteDocument(context.contentResolver, uri)
                else context.contentResolver.delete(uri, null, null) > 0
            }.getOrDefault(false)
        } else {
            true
        }
        dao.delete(item.id)
        deleted
    }

    suspend fun clear() = dao.clear()
}
