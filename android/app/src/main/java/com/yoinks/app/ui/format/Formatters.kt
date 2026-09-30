package com.yoinks.app.ui.format

import java.util.Locale

object Formatters {
    fun duration(seconds: Long): String {
        val h = seconds / 3600
        val m = (seconds % 3600) / 60
        val s = seconds % 60
        return if (h > 0) String.format(Locale.ROOT, "%d:%02d:%02d", h, m, s) else String.format(Locale.ROOT, "%d:%02d", m, s)
    }

    fun bytes(bytes: Long?): String {
        if (bytes == null || bytes <= 0) return ""
        val units = listOf("B", "KB", "MB", "GB")
        var value = bytes.toDouble()
        var unit = 0
        while (value >= 1024 && unit < units.lastIndex) {
            value /= 1024
            unit++
        }
        return if (value >= 100 || unit == 0) "${value.toLong()} ${units[unit]}" else String.format(Locale.getDefault(), "%.1f %s", value, units[unit])
    }

    fun timeAgo(millis: Long, now: Long = System.currentTimeMillis()): String {
        val s = (now - millis) / 1000
        return when {
            s < 60 -> "just now"
            s < 3600 -> "${s / 60} min ago"
            s < 86_400 -> "${s / 3600} h ago"
            else -> java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM).format(java.util.Date(millis))
        }
    }

    /** "1:05", "1:02:03", "65" or "65.5" -> seconds; blank -> null; junk -> NaN. */
    fun parseTime(text: String): Double? {
        val t = text.trim()
        if (t.isEmpty()) return null
        if (!Regex("""^\d+(:\d{1,2}){0,2}(\.\d+)?$""").matches(t)) return Double.NaN
        return t.split(':').fold(0.0) { total, part -> total * 60 + part.toDouble() }
    }
}
