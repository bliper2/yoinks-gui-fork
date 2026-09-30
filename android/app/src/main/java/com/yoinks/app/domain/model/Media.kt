package com.yoinks.app.domain.model

import kotlinx.serialization.Serializable

enum class MediaKind { VIDEO, AUDIO }

/** One entry of the quality list shown in the share sheet. */
@Serializable
data class FormatOption(
    val kind: MediaKind,
    val label: String,
    /** Video height in pixels; null for audio or "best available". */
    val height: Int? = null,
    /** The height exists exactly (single video) rather than as a cap (playlist). */
    val exact: Boolean = false,
    val ext: String,
    val sizeBytes: Long? = null,
)

/** What a lookup (yt-dlp -J) tells us about a link. */
data class MediaInfo(
    val url: String,
    val platform: Platform,
    val title: String,
    val uploader: String?,
    val durationSeconds: Long?,
    val thumbnail: String?,
    val isPlaylist: Boolean,
    val playlistCount: Int?,
    val formats: List<FormatOption>,
    val defaultIndex: Int,
    /** TikTok photo post: yt-dlp can only save its sound. */
    val isSlideshow: Boolean = false,
)

@Serializable
data class Clip(val startSeconds: Double, val endSeconds: Double?)

/** What the user asked to download. Plain data so it survives in the queue. */
@Serializable
data class DownloadRequest(
    val url: String,
    val title: String,
    val thumbnail: String? = null,
    /** "best", a height like "1080", or "audio". */
    val format: String,
    /** The chosen height exists exactly (from the quality list). */
    val exactHeight: Boolean = false,
    val playlist: Boolean = false,
    val clip: Clip? = null,
    /** Set for Spotify links: the confirmed YouTube Music matches. */
    val spotify: List<SpotifyPick>? = null,
) {
    val kind: MediaKind get() = if (format == "audio" || spotify != null) MediaKind.AUDIO else MediaKind.VIDEO
}

// ---------- Spotify ----------

@Serializable
data class SpotifyTrack(
    val id: String?,
    val title: String,
    val artists: List<String>,
    val durationMs: Long?,
    val album: String?,
    val trackNumber: Int?,
)

data class SpotifyEntity(
    val type: String, // track | album | playlist
    val title: String,
    val artists: List<String>,
    val cover: String?,
    val year: String?,
    val tracks: List<SpotifyTrack>,
)

@Serializable
data class MusicCandidate(
    val url: String,
    val title: String,
    val artist: String,
    val album: String?,
    val durationSeconds: Long?,
    val confidence: Int = 0,
) {
    val level: Confidence get() = Confidence.of(confidence)
}

enum class Confidence {
    HIGH, MEDIUM, LOW;

    companion object {
        fun of(score: Int) = when {
            score >= 80 -> HIGH
            score >= 55 -> MEDIUM
            else -> LOW
        }
    }
}

data class SpotifyLookup(val entity: SpotifyEntity, val candidates: List<List<MusicCandidate>>)

/** A confirmed Spotify track and the YouTube Music result to download for it. */
@Serializable
data class SpotifyPick(
    val track: SpotifyTrack,
    val candidateUrl: String,
    val cover: String?,
    val year: String?,
    val collectionTitle: String?,
    val index: Int,
    val albumArtists: List<String> = emptyList(),
)

// ---------- engine progress ----------

data class EngineProgress(
    /** 0..1, or null when unknown. */
    val fraction: Float?,
    val etaSeconds: Long?,
    val speed: String?,
    val processing: Boolean = false,
    val item: ItemProgress? = null,
)

data class ItemProgress(val index: Int, val count: Int)
