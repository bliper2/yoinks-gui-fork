package com.yoinks.app.data.cookies

import android.content.Context
import android.net.Uri
import com.yoinks.app.domain.model.YoinksError
import com.yoinks.app.domain.model.YoinksException
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * An imported browser cookies file (Netscape "cookies.txt" format) kept in
 * app-private storage. It is only ever given to yt-dlp, which sends each
 * cookie only to its own site. Nothing is uploaded anywhere.
 */
@Singleton
class CookieStore @Inject constructor(@ApplicationContext private val context: Context) {
    val file: File get() = File(context.filesDir, "cookies.txt")

    val hasCookies: Boolean get() = file.isFile && file.length() > 0

    suspend fun import(uri: Uri): Int = withContext(Dispatchers.IO) {
        val text = context.contentResolver.openInputStream(uri)?.use { input ->
            val bytes = input.readNBytesCompat(MAX_BYTES + 1)
            if (bytes.size > MAX_BYTES) throw invalid("That file is too big to be a cookies file.")
            String(bytes, Charsets.UTF_8)
        } ?: throw invalid("Could not read that file.")
        val count = countCookies(text)
        if (count == 0) throw invalid("That is not a cookies.txt file. Export cookies in the Netscape format.")
        val tmp = File(context.filesDir, "cookies.txt.tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
        count
    }

    fun clear() {
        file.delete()
    }

    private fun invalid(message: String) = YoinksException(YoinksError("cookies", message, false))

    private fun java.io.InputStream.readNBytesCompat(limit: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (out.size() < limit) {
            val read = read(buffer, 0, minOf(buffer.size, limit - out.size()))
            if (read < 0) break
            out.write(buffer, 0, read)
        }
        return out.toByteArray()
    }

    companion object {
        private const val MAX_BYTES = 5 * 1024 * 1024

        /** Number of valid cookie lines (7 tab-separated fields). */
        fun countCookies(text: String): Int = text.lineSequence()
            .map { it.removePrefix("#HttpOnly_") }
            .filter { it.isNotBlank() && !it.startsWith("#") }
            .count { it.split('\t').size == 7 }
    }
}
