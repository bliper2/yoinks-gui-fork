package com.yoinks.app.domain.match

import com.yoinks.app.domain.model.MusicCandidate
import com.yoinks.app.domain.model.SpotifyTrack
import java.text.Normalizer
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * How well a YouTube Music result matches a Spotify track, 0–100.
 * Same scoring as the Windows app: title 45%, artist 30%, duration 25%,
 * minus penalties for "live", "remix", "cover"… when Spotify's title lacks them.
 */
object MatchScorer {
    private val VARIANT_WORDS = listOf("live", "remix", "cover", "karaoke", "instrumental", "acoustic", "sped up", "slowed", "nightcore", "8d", "reverb", "mashup", "edit", "version", "demo")

    fun normalize(text: String?): String =
        Normalizer.normalize(text.orEmpty().lowercase(), Normalizer.Form.NFKD)
            .replace(Regex("\\p{M}+"), "")
            .replace(Regex("""\((feat|ft|with)\.?[^)]*\)|\[(feat|ft|with)\.?[^\]]*]"""), " ")
            .replace(Regex("""\b(feat|ft)\.?\s.*$"""), " ")
            .replace(Regex("""[^\p{L}\p{N}]+"""), " ")
            .trim()

    private fun coreTitle(text: String?): String =
        normalize(text)
            .replace(Regex("""\b(\d{4} )?(remaster(ed)?|remastered version|mono|stereo|radio edit|single version|original mix|explicit|clean)\b( \d{4})?"""), " ")
            .replace(Regex("\\s+"), " ")
            .trim()

    private fun similarity(a: String, b: String): Double {
        val ta = a.split(' ').filter { it.isNotEmpty() }.toSet()
        val tb = b.split(' ').filter { it.isNotEmpty() }.toSet()
        if (ta.isEmpty() || tb.isEmpty()) return 0.0
        return 2.0 * ta.count { it in tb } / (ta.size + tb.size)
    }

    private fun durationScore(expectedMs: Long?, actualSeconds: Long?): Double {
        if (expectedMs == null || actualSeconds == null || expectedMs <= 0 || actualSeconds <= 0) return 0.5
        val diff = abs(expectedMs / 1000.0 - actualSeconds)
        return when {
            diff <= 2 -> 1.0
            diff <= 5 -> 0.85
            diff <= 10 -> 0.6
            diff <= 20 -> 0.3
            else -> 0.0
        }
    }

    private fun artistScore(expected: List<String>, candidate: String): Double {
        val have = normalize(candidate)
        if (expected.isEmpty() || have.isEmpty()) return 0.5
        val hits = expected.map { name ->
            val n = normalize(name)
            n.isNotEmpty() && (have.contains(n) || similarity(n, have) >= 0.6)
        }
        return when {
            hits.first() -> 0.8 + 0.2 * hits.count { it } / hits.size
            hits.any { it } -> 0.5
            else -> 0.0
        }
    }

    fun score(track: SpotifyTrack, candidate: MusicCandidate): Int {
        val title = similarity(coreTitle(track.title), coreTitle(candidate.title))
        val artist = artistScore(track.artists, candidate.artist)
        val duration = durationScore(track.durationMs, candidate.durationSeconds)
        var total = 0.45 * title + 0.3 * artist + 0.25 * duration
        val wanted = normalize(track.title)
        val got = normalize(candidate.title)
        for (word in VARIANT_WORDS) {
            val re = Regex("\\b${Regex.escape(word)}\\b")
            if (re.containsMatchIn(got) && !re.containsMatchIn(wanted)) total -= 0.2
        }
        return (total * 100).roundToInt().coerceIn(0, 100)
    }

    /** Candidates with their confidence, best first. */
    fun rank(track: SpotifyTrack, candidates: List<MusicCandidate>): List<MusicCandidate> =
        candidates.map { it.copy(confidence = score(track, it)) }.sortedByDescending { it.confidence }
}
