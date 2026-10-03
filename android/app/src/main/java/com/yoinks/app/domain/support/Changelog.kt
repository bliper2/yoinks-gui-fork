package com.yoinks.app.domain.support

/** Reads the app's CHANGELOG.md ("## 2.2.0" sections, newest first). */
object Changelog {
    /** The section for [version] without its heading line, or null if there is none. */
    fun section(markdown: String, version: String): String? {
        val lines = markdown.lines()
        val start = lines.indexOfFirst { it.trim() == "## $version" }
        if (start < 0) return null
        val end = lines.drop(start + 1).indexOfFirst { it.startsWith("## ") }.let { if (it < 0) lines.size else start + 1 + it }
        return lines.subList(start + 1, end).joinToString("\n").trim().ifEmpty { null }
    }
}
