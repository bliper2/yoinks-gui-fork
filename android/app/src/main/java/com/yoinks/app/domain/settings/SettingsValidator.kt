package com.yoinks.app.domain.settings

import com.yoinks.app.domain.format.FilenameTemplate
import com.yoinks.app.domain.model.AppSettings

/** Result of validating a settings change: the safe value plus any problems. */
data class Validated(val settings: AppSettings, val errors: Map<String, String>)

/**
 * The one set of rules for settings values. Used on every save, on load
 * (to repair bad stored data) and on JSON import. Invalid values keep the
 * previous value and produce a readable error.
 */
object SettingsValidator {
    val UPDATE_INTERVALS = listOf(1, 7, 30)
    private val LANG = Regex("^([a-z]{2,3}(-[A-Za-z0-9]{2,4})?|all)$")

    fun validate(candidate: AppSettings, previous: AppSettings = AppSettings()): Validated {
        val errors = linkedMapOf<String, String>()
        var s = candidate

        if (s.concurrency !in 1..5) {
            errors["concurrency"] = "Downloads at the same time must be between 1 and 5."
            s = s.copy(concurrency = previous.concurrency.coerceIn(1, 5))
        }
        if (s.retries !in 0..10) {
            errors["retries"] = "Retries must be between 0 and 10."
            s = s.copy(retries = previous.retries.coerceIn(0, 10))
        }
        if (s.speedLimitMbps.isNaN() || s.speedLimitMbps !in 0f..1000f) {
            errors["speedLimitMbps"] = "Speed limit must be between 0 and 1000 MB/s."
            s = s.copy(speedLimitMbps = previous.speedLimitMbps.takeIf { it in 0f..1000f } ?: 0f)
        }
        FilenameTemplate.validate(s.filenameTemplate)?.let {
            errors["filenameTemplate"] = "File name $it."
            s = s.copy(filenameTemplate = previous.filenameTemplate.takeIf { t -> FilenameTemplate.validate(t) == null } ?: "{title}")
        }
        if (!LANG.matches(s.subsLang.trim())) {
            errors["subsLang"] = "Subtitle language must be a code like en or pt-BR."
            s = s.copy(subsLang = previous.subsLang)
        } else {
            s = s.copy(subsLang = s.subsLang.trim())
        }
        if (s.ytdlpUpdateDays !in UPDATE_INTERVALS) {
            errors["ytdlpUpdateDays"] = "Update interval must be daily, weekly or monthly."
            s = s.copy(ytdlpUpdateDays = 7)
        }
        if ((s.customAccent ushr 24) != 0xFFL || s.customAccent !in 0L..0xFFFFFFFFL) {
            errors["customAccent"] = "Custom color must be an opaque color."
            s = s.copy(customAccent = previous.customAccent)
        }
        listOf(s.videoFolderUri, s.audioFolderUri).forEach { uri ->
            if (uri != null && !uri.startsWith("content://")) {
                errors["folder"] = "Folders must be picked with the folder picker."
            }
        }
        if (errors.containsKey("folder")) {
            s = s.copy(
                videoFolderUri = s.videoFolderUri?.takeIf { it.startsWith("content://") },
                audioFolderUri = s.audioFolderUri?.takeIf { it.startsWith("content://") },
            )
        }
        if (s.termsAccepted < 0) s = s.copy(termsAccepted = 0)
        return Validated(s, errors)
    }

    /** Repair whatever was stored (never throws). */
    fun sanitize(stored: AppSettings): AppSettings = validate(stored, AppSettings()).settings
}
