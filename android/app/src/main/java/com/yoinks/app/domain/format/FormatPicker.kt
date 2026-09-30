package com.yoinks.app.domain.format

import com.yoinks.app.domain.model.FormatOption
import com.yoinks.app.domain.model.MediaKind

object FormatPicker {
    /**
     * Index of the best option for a wanted format ("best", "1080", "audio"):
     * audio -> the audio entry; a height -> the tallest video that fits
     * (else the smallest); best -> the tallest. -1 if the list is empty.
     */
    fun pick(options: List<FormatOption>, format: String): Int {
        if (options.isEmpty()) return -1
        if (format == "audio") return options.indexOfFirst { it.kind == MediaKind.AUDIO }
        val videos = options.withIndex().filter { it.value.kind == MediaKind.VIDEO }
        if (videos.isEmpty()) return options.indexOfFirst { it.kind == MediaKind.AUDIO }
        val cap = format.toIntOrNull() ?: return videos.first().index
        return (videos.firstOrNull { (it.value.height ?: Int.MAX_VALUE) <= cap } ?: videos.last()).index
    }

    /** The wanted-format string that reproduces an option (for the queue). */
    fun formatOf(option: FormatOption): String = when {
        option.kind == MediaKind.AUDIO -> "audio"
        option.height != null -> option.height.toString()
        else -> "best"
    }
}
