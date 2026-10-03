package com.yoinks.app.domain.health

enum class HealthStatus { OK, WARN, FAIL }

data class HealthItem(val label: String, val status: HealthStatus, val detail: String)

/** The judgement calls of the health check, apart from the Android calls that gather the facts. */
object HealthRules {
    private const val ONE_GB = 1024L * 1024 * 1024

    /** "2026.08.19" -> whole days between that date and [today], or null if it is not a date. */
    fun ytdlpAgeDays(version: String?, today: java.time.LocalDate = java.time.LocalDate.now()): Long? {
        val m = Regex("^(\\d{4})\\.(\\d{2})\\.(\\d{2})").find(version.orEmpty()) ?: return null
        val date = runCatching { java.time.LocalDate.of(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt()) }.getOrNull() ?: return null
        return java.time.temporal.ChronoUnit.DAYS.between(date, today)
    }

    fun ytdlp(version: String?, autoUpdate: Boolean, today: java.time.LocalDate = java.time.LocalDate.now()): HealthItem {
        if (version == null) return HealthItem("yt-dlp", HealthStatus.FAIL, "Not available. Try Update now, or reinstall Yoinks.")
        val age = ytdlpAgeDays(version, today)
        return if (age != null && age > 90 && !autoUpdate) HealthItem("yt-dlp", HealthStatus.WARN, "$version is $age days old and automatic updates are off; sites may have changed.")
        else HealthItem("yt-dlp", HealthStatus.OK, version)
    }

    fun storage(freeBytes: Long): HealthItem {
        val gb = String.format(java.util.Locale.US, "%.1f GB", freeBytes.toDouble() / ONE_GB)
        return if (freeBytes < ONE_GB) HealthItem("Storage", HealthStatus.WARN, "Only $gb free on this phone.")
        else HealthItem("Storage", HealthStatus.OK, "$gb free.")
    }

    fun battery(percent: Int?, charging: Boolean, pauseOnLow: Boolean): HealthItem = when {
        percent == null -> HealthItem("Battery", HealthStatus.OK, "Not reported by this phone.")
        percent <= 15 && !charging -> HealthItem("Battery", if (pauseOnLow) HealthStatus.WARN else HealthStatus.OK, "$percent% and not charging." + if (pauseOnLow) " Downloads wait until it charges." else "")
        else -> HealthItem("Battery", HealthStatus.OK, "$percent%" + if (charging) ", charging." else ".")
    }
}
