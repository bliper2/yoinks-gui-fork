package com.yoinks.app.domain.format

/**
 * File name templates like "{artist} - {title}": validation, live preview
 * and conversion to a yt-dlp output template. Same rules as the Windows app.
 */
object FilenameTemplate {
    private data class Token(val ytdlp: String, val sample: String)

    private val TOKENS = linkedMapOf(
        "title" to Token("%(title).120B", "Never Gonna Give You Up"),
        "artist" to Token("%(artist,creator,uploader|Unknown artist)s", "Rick Astley"),
        "album" to Token("%(album|Unknown album)s", "Whenever You Need Somebody"),
        "track" to Token("%(track,title).120B", "Never Gonna Give You Up"),
        "uploader" to Token("%(uploader,channel|Unknown)s", "Rick Astley"),
        "date" to Token("%(upload_date>%Y-%m-%d|)s", "1987-11-12"),
        "year" to Token("%(release_year,upload_date>%Y|)s", "1987"),
        "id" to Token("%(id)s", "dQw4w9WgXcQ"),
    )

    val tokenNames: List<String> get() = TOKENS.keys.toList()

    private val PART = Regex("\\{([a-z]+)\\}")
    // Characters file systems forbid, and "%" which would clash with yt-dlp.
    private val FORBIDDEN = Regex("[<>:\"/\\\\|?*%\\u0000-\\u001f]")

    /** null when valid, else a reason that reads after "File name …". */
    fun validate(template: String): String? {
        val t = template.trim()
        if (t.isEmpty()) return "cannot be empty"
        if (t.length > 120) return "is too long (120 characters max)"
        val names = PART.findAll(t).map { it.groupValues[1] }.toList()
        names.firstOrNull { it !in TOKENS }?.let { return "has an unknown part {$it}" }
        if (names.isEmpty()) return "needs at least one part like {title}"
        val literal = PART.replace(t, "")
        if (FORBIDDEN.containsMatchIn(literal)) return "cannot contain < > : \" / \\ | ? * or %"
        if (literal.contains('{') || literal.contains('}')) return "has an unmatched { or }"
        if (t.endsWith('.') || t.endsWith(' ')) return "cannot end with a dot or space"
        return null
    }

    /** Example name, e.g. "Rick Astley - Never Gonna Give You Up.mp3" (or an error). */
    fun preview(template: String, ext: String, playlist: Boolean = false, folder: Boolean = true, numbered: Boolean = true): Result<String> {
        validate(template)?.let { return Result.failure(IllegalArgumentException("File name $it.")) }
        var name = PART.replace(template.trim()) { TOKENS.getValue(it.groupValues[1]).sample } + ".$ext"
        if (playlist && numbered) name = "001 - $name"
        if (playlist && folder) name = "My Playlist/$name"
        return Result.success(name)
    }

    /** yt-dlp output template, relative to the download folder. */
    fun toYtdlp(template: String, playlist: Boolean, folder: Boolean, numbered: Boolean, suffix: String = ""): String {
        val t = if (validate(template) == null) template.trim() else "{title}"
        var out = PART.replace(t) { TOKENS.getValue(it.groupValues[1]).ytdlp } + suffix + ".%(ext)s"
        if (playlist && numbered) out = "%(playlist_index)03d - $out"
        if (playlist && folder) out = "%(playlist_title,playlist|Playlist).80B/$out"
        return out
    }
}
