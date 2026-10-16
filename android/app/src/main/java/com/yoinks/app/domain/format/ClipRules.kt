package com.yoinks.app.domain.format

import com.yoinks.app.domain.model.Clip

/** Clip times typed by the user. Blank is not a time; junk is not a number. */
object ClipRules {
    fun parseTime(text: String): Double? {
        val t = text.trim()
        if (t.isEmpty()) return null
        if (!Regex("""^\d+(:\d{1,2}){0,2}(\.\d+)?$""").matches(t)) return Double.NaN
        return t.split(':').fold(0.0) { total, part -> total * 60 + part.toDouble() }
    }

    /**
     * A clip from the two text fields.
     * Both empty is not "the whole video": that would still pass clip flags.
     * A blank start with an end means "from the beginning". A blank end means "until the video ends".
     */
    fun fromFields(startText: String, endText: String): Result {
        if (startText.isBlank() && endText.isBlank()) return Result.Invalid("Set a start or an end, or turn the clip off.")
        val start = parseTime(startText)
        val end = parseTime(endText)
        if (startText.isNotBlank() && (start == null || start.isNaN())) return Result.Invalid("Write times like 1:05 or 65.")
        if (endText.isNotBlank() && (end == null || end.isNaN())) return Result.Invalid("Write times like 1:05 or 65.")
        val from = start ?: 0.0
        if (end != null && end <= from) return Result.Invalid("The clip has to end after it starts.")
        return Result.Ok(Clip(from, end))
    }

    sealed interface Result {
        data class Ok(val clip: Clip) : Result
        data class Invalid(val message: String) : Result
    }
}
