package com.yoinks.app.data.link

import com.yoinks.app.domain.link.LinkExtractor
import com.yoinks.app.domain.model.LinkRules
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URI
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Follows share short links (vm.tiktok.com, snapchat.com/t/…, on.soundcloud.com,
 * spotify.link, pin.it, …)
 * to the real page before analysis. Safe by construction: at most
 * [MAX_HOPS] redirects, each target must be http(s) with a host, bodies are
 * never read, and any failure just returns the original link (yt-dlp can
 * often resolve it itself).
 */
@Singleton
class LinkResolver @Inject constructor(client: OkHttpClient) {
    private val client = client.newBuilder().followRedirects(false).followSslRedirects(false).build()

    suspend fun resolve(url: String): String {
        if (!LinkRules.isShortLink(url)) return url
        LinkRules.appLinkTarget(url)?.let { return it } // spotify.app.link/?$full_url=…: no request needed
        return withContext(Dispatchers.IO) {
            var current = url
            repeat(MAX_HOPS) {
                val next = runCatching { nextHop(current) }.getOrNull() ?: return@withContext current
                current = next
                if (!LinkRules.isShortLink(current)) return@withContext current
            }
            current
        }
    }

    /** The redirect target of [url], or null when it doesn't redirect. */
    private fun nextHop(url: String): String? {
        val request = Request.Builder().url(url).get().header("User-Agent", DESKTOP_UA).build()
        client.newCall(request).execute().use { response ->
            if (!response.isRedirect) return null
            val location = response.header("Location")?.trim() ?: return null
            // "Open the app" redirects (intent://…) still carry the web page inside.
            LinkRules.appLinkTarget(location)?.let { return LinkExtractor.normalize(it) }
            val absolute = URI(url).resolve(location).toString()
            return LinkExtractor.normalize(absolute)
        }
    }

    private companion object {
        const val MAX_HOPS = 5
        // A desktop browser: sent from a phone, spotify.link answers with intent:// app links.
        const val DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
    }
}
