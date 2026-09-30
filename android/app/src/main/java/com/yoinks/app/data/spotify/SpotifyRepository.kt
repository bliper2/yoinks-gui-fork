package com.yoinks.app.data.spotify

import com.yoinks.app.domain.engine.MediaEngine
import com.yoinks.app.domain.match.MatchScorer
import com.yoinks.app.domain.model.AppSettings
import com.yoinks.app.domain.model.SpotifyEntity
import com.yoinks.app.domain.model.SpotifyLookup
import com.yoinks.app.domain.model.SpotifyTrack
import com.yoinks.app.domain.model.YoinksError
import com.yoinks.app.domain.model.YoinksException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URI
import java.util.concurrent.atomic.AtomicInteger
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Spotify without touching Spotify's audio or DRM: read the public metadata
 * from a link's embed page, then find each song on YouTube Music.
 */
@Singleton
class SpotifyRepository @Inject constructor(
    private val client: OkHttpClient,
    private val json: Json,
    private val engine: MediaEngine,
) {
    data class Ref(val type: String, val id: String)

    fun parse(url: String): Ref? {
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        if (uri.scheme != "https" || uri.host != "open.spotify.com") return null
        val m = Regex("""^/(?:intl-[\w-]+/)?(track|album|playlist)/([A-Za-z0-9]{22})/?$""").find(uri.path.orEmpty()) ?: return null
        return Ref(m.groupValues[1], m.groupValues[2])
    }

    suspend fun lookup(url: String, settings: AppSettings, onProgress: (done: Int, total: Int) -> Unit): SpotifyLookup {
        val ref = parse(url) ?: throw fail("unsupported", "That is not a Spotify track, album or playlist link.")
        val entity = fetchEntity(ref)
        val done = AtomicInteger(0)
        val limit = if (entity.tracks.size == 1) 5 else 3
        val gate = Semaphore(3)
        val candidates = coroutineScope {
            entity.tracks.map { track ->
                async {
                    gate.withPermit {
                        val found = runCatching {
                            engine.searchMusic("${track.artists.firstOrNull().orEmpty()} ${track.title}".trim(), limit, settings)
                        }.getOrDefault(emptyList())
                        onProgress(done.incrementAndGet(), entity.tracks.size)
                        MatchScorer.rank(track, found)
                    }
                }
            }.awaitAll()
        }
        return SpotifyLookup(entity, candidates)
    }

    /** Cover and year of one playlist track (playlist pages don't include them). */
    suspend fun trackDetails(trackId: String?): Pair<String?, String?> {
        if (trackId == null || !Regex("^[A-Za-z0-9]{22}$").matches(trackId)) return null to null
        return runCatching {
            val e = embed(Ref("track", trackId))
            largestImage(e["visualIdentity"]?.jsonObject?.get("image")) to year(e)
        }.getOrDefault(null to null)
    }

    private suspend fun fetchEntity(ref: Ref): SpotifyEntity {
        val e = embed(ref)
        val artists = artistsOf(e)
        val title = e.str("title") ?: e.str("name") ?: "Spotify"
        val tracks = if (ref.type == "track") {
            listOf(SpotifyTrack(e.str("id"), title, artists, (e["duration"] as? JsonPrimitive)?.longOrNull, null, null))
        } else {
            (e["trackList"] as? JsonArray).orEmpty()
                .mapNotNull { it as? JsonObject }
                .filter { it.str("entityType") == "track" || it.str("uri")?.startsWith("spotify:track:") == true }
                .mapIndexed { i, t ->
                    SpotifyTrack(
                        id = t.str("uri")?.substringAfterLast(':'),
                        title = t.str("title").orEmpty(),
                        artists = artistsOf(t),
                        durationMs = (t["duration"] as? JsonPrimitive)?.longOrNull,
                        album = if (ref.type == "album") title else null,
                        trackNumber = if (ref.type == "album") i + 1 else null,
                    )
                }
        }
        if (tracks.isEmpty()) throw fail("removed", "That Spotify page has no playable tracks.")
        val cover = largestImage(e["visualIdentity"]?.jsonObject?.get("image")) ?: largestImage(e["coverArt"]?.jsonObject?.get("sources"))
        return SpotifyEntity(ref.type, title, artists, cover, year(e), tracks)
    }

    private suspend fun embed(ref: Ref): JsonObject = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("https://open.spotify.com/embed/${ref.type}/${ref.id}")
            .header("User-Agent", "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36")
            .build()
        val html = client.newCall(request).execute().use { response ->
            if (response.code == 404) throw fail("removed", "That Spotify link does not exist or is not public.")
            if (!response.isSuccessful) throw fail("network", "Spotify answered with an error (${response.code}). Try again later.", retryable = true)
            val body = response.body.string()
            if (body.length > 2_000_000) throw fail("unknown", "Spotify sent an unexpected page.")
            body
        }
        val data = Regex("""<script id="__NEXT_DATA__" type="application/json">([\s\S]*?)</script>""").find(html)?.groupValues?.get(1)
            ?: throw fail("unknown", "Could not read that Spotify page. Spotify may have changed it; try updating Yoinks.")
        runCatching {
            json.parseToJsonElement(data).jsonObject["props"]!!.jsonObject["pageProps"]!!.jsonObject["state"]!!
                .jsonObject["data"]!!.jsonObject["entity"]!!.jsonObject
        }.getOrElse { throw fail("unknown", "Could not read that Spotify page. Spotify may have changed it; try updating Yoinks.") }
    }

    private fun artistsOf(o: JsonObject): List<String> =
        (o["artists"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.str("name") }?.takeIf { it.isNotEmpty() }
            ?: o.str("subtitle").orEmpty().split(Regex(",\\s*")).map { it.trim() }.filter { it.isNotEmpty() }

    private fun largestImage(images: kotlinx.serialization.json.JsonElement?): String? =
        (images as? JsonArray).orEmpty()
            .mapNotNull { it as? JsonObject }
            .filter { it.str("url")?.startsWith("https://") == true }
            .maxByOrNull { ((it["maxWidth"] ?: it["width"]) as? JsonPrimitive)?.longOrNull ?: 0L }
            ?.str("url")

    private fun year(e: JsonObject): String? = e["releaseDate"]?.let { it as? JsonObject }?.str("isoString")?.take(4)

    private fun JsonObject.str(key: String) = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    private fun fail(code: String, message: String, retryable: Boolean = false) = YoinksException(YoinksError(code, message, retryable))
}
