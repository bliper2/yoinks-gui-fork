package com.yoinks.app.domain.queue

import com.yoinks.app.domain.model.AppSettings
import java.time.LocalTime

/** Is the download window open? Windows can cross midnight; equal times mean "always". */
object DownloadWindow {
    fun minutes(hhmm: String): Int? {
        val parts = hhmm.split(":")
        if (parts.size != 2) return null
        val h = parts[0].toIntOrNull() ?: return null
        val m = parts[1].toIntOrNull() ?: return null
        return if (h in 0..23 && m in 0..59) h * 60 + m else null
    }

    fun isOpen(settings: AppSettings, now: LocalTime): Boolean {
        if (!settings.scheduleOn) return true
        val from = minutes(settings.scheduleFrom) ?: return true
        val to = minutes(settings.scheduleTo) ?: return true
        if (from == to) return true
        val t = now.hour * 60 + now.minute
        return if (from < to) t in from until to else t >= from || t < to
    }
}

/**
 * Why pending downloads must wait right now, or null when they may start.
 * The first matching reason wins, so the status line says the most basic
 * problem first (no connection before "battery is low").
 */
object QueueGate {
    const val LOW_BATTERY_PERCENT = 15

    fun waitingText(
        settings: AppSettings,
        online: Boolean,
        unmetered: Boolean,
        dataSaverOn: Boolean,
        batteryPercent: Int?,
        charging: Boolean,
        now: LocalTime,
    ): String? = when {
        !online -> "Waiting for a connection"
        settings.wifiOnly && !unmetered -> "Waiting for Wi-Fi"
        settings.respectDataSaver && dataSaverOn && !unmetered -> "Waiting (Data Saver is on)"
        settings.pauseOnLowBattery && batteryPercent != null && batteryPercent <= LOW_BATTERY_PERCENT && !charging -> "Waiting (battery is low)"
        !DownloadWindow.isOpen(settings, now) -> "Waiting for ${settings.scheduleFrom}"
        else -> null
    }
}
