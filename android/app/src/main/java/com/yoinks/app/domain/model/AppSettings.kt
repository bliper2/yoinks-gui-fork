package com.yoinks.app.domain.model

import kotlinx.serialization.Serializable

enum class ThemeMode { SYSTEM, LIGHT, DARK }

enum class AccentPreset(val argb: Long, val label: String) {
    VIOLET(0xFF8B6BFF, "Violet"),
    OCEAN(0xFF2F80ED, "Ocean"),
    SUNSET(0xFFFF6A4D, "Sunset"),
    FOREST(0xFF1FBF6A, "Forest"),
    ROSE(0xFFF0457A, "Rose"),
    CUSTOM(0xFF8B6BFF, "Custom"),
}

enum class DefaultFormat(val key: String, val label: String) {
    BEST("best", "Best video"),
    P2160("2160", "4K (2160p)"),
    P1440("1440", "1440p"),
    P1080("1080", "1080p"),
    P720("720", "720p"),
    P480("480", "480p"),
    AUDIO("audio", "Audio only"),
}

enum class AudioFormat(val ext: String, val label: String) {
    MP3("mp3", "MP3"),
    M4A("m4a", "M4A (AAC)"),
    FLAC("flac", "FLAC (lossless)"),
    OPUS("opus", "Opus"),
}

enum class AudioBitrate(val kbps: Int?, val label: String) {
    BEST(null, "Best (VBR)"),
    K320(320, "320 kbps"),
    K256(256, "256 kbps"),
    K192(192, "192 kbps"),
    K128(128, "128 kbps"),
}

enum class ShareBehavior(val label: String) {
    ASK("Show the options sheet"),
    INSTANT("Download instantly with the default format"),
}

/**
 * Every setting, with its default. Stored as one JSON document in DataStore
 * (data/settings). Always pass values through [SettingsValidator] before saving.
 */
@Serializable
data class AppSettings(
    // Look
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val dynamicColor: Boolean = true,
    val amoledBlack: Boolean = false,
    val accent: AccentPreset = AccentPreset.VIOLET,
    val customAccent: Long = 0xFF8B6BFF,
    // Folders: null = Movies/Yoinks and Music/Yoinks; else a SAF tree URI.
    val videoFolderUri: String? = null,
    val audioFolderUri: String? = null,
    // Formats
    val defaultFormat: DefaultFormat = DefaultFormat.BEST,
    val alwaysUseFormat: Boolean = false,
    val filenameTemplate: String = "{title}",
    val audioFormat: AudioFormat = AudioFormat.MP3,
    val audioBitrate: AudioBitrate = AudioBitrate.BEST,
    // Tags
    val embedMetadata: Boolean = true,
    val embedThumbnail: Boolean = true,
    val embedSubs: Boolean = false,
    val subsLang: String = "en",
    val tiktokNoWatermark: Boolean = true,
    // Playlists
    val playlistFolder: Boolean = true,
    val playlistNumbered: Boolean = true,
    // Queue
    val concurrency: Int = 2,
    val speedLimitMbps: Float = 0f,
    val retries: Int = 2,
    val wifiOnly: Boolean = false,
    val notifications: Boolean = true,
    // Sharing
    val shareBehavior: ShareBehavior = ShareBehavior.ASK,
    val clipboardDetection: Boolean = false,
    // yt-dlp
    val ytdlpAutoUpdate: Boolean = true,
    val ytdlpUpdateDays: Int = 7,
    val useCookies: Boolean = false,
    // First run
    val termsAccepted: Int = 0,
) {
    companion object {
        /** Bump when terms/privacy change so people accept again. */
        const val TERMS_VERSION = 1
    }
}
