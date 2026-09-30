package com.yoinks.app.data.spotify

import com.yoinks.app.domain.model.SpotifyPick
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * Puts Spotify's metadata onto a YouTube Music info dict so yt-dlp writes it
 * (tags, cover, file name) exactly like any other download.
 */
object SpotifyMetadata {
    fun apply(info: JsonObject, pick: SpotifyPick): JsonObject {
        val track = pick.track
        val artist = track.artists.joinToString(", ")
        val patch = buildMap<String, kotlinx.serialization.json.JsonElement> {
            put("title", JsonPrimitive(track.title))
            put("track", JsonPrimitive(track.title))
            put("artist", JsonPrimitive(artist))
            put("artists", JsonArray(track.artists.map(::JsonPrimitive)))
            put("creator", JsonPrimitive(artist))
            put("creators", JsonArray(track.artists.map(::JsonPrimitive)))
            (track.album ?: (info["album"] as? JsonPrimitive)?.content)?.let { put("album", JsonPrimitive(it)) }
            if (pick.albumArtists.isNotEmpty()) put("album_artist", JsonPrimitive(pick.albumArtists.joinToString(", ")))
            put("track_number", track.trackNumber?.let { JsonPrimitive(it) } ?: JsonNull)
            pick.year?.toIntOrNull()?.let {
                put("release_year", JsonPrimitive(it))
                put("upload_date", JsonPrimitive("${it}0101"))
            }
            if (pick.collectionTitle != null) {
                put("playlist_title", JsonPrimitive(pick.collectionTitle))
                put("playlist_index", JsonPrimitive(pick.index + 1))
            }
            pick.cover?.let { cover ->
                put("thumbnail", JsonPrimitive(cover))
                put("thumbnails", JsonArray(listOf(buildJsonObject { put("url", JsonPrimitive(cover)); put("id", JsonPrimitive("spotify")) })))
            }
        }
        return JsonObject(info + patch)
    }
}
