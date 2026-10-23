package com.yoinks.app.domain.model

import java.net.URI

/**
 * Sites Yoinks knows by name. Anything else still goes through yt-dlp's
 * generic support as [OTHER]. Music platforms default to audio.
 */
enum class Platform(val displayName: String, val isMusic: Boolean) {
    YOUTUBE("YouTube", false),
    YOUTUBE_MUSIC("YouTube Music", true),
    TIKTOK("TikTok", false),
    SNAPCHAT("Snapchat", false),
    INSTAGRAM("Instagram", false),
    X("X", false),
    FACEBOOK("Facebook", false),
    REDDIT("Reddit", false),
    SOUNDCLOUD("SoundCloud", true),
    BANDCAMP("Bandcamp", true),
    SPOTIFY("Spotify", true),
    VIMEO("Vimeo", false),
    TWITCH("Twitch", false),
    DAILYMOTION("Dailymotion", false),
    STREAMABLE("Streamable", false),
    RUMBLE("Rumble", false),
    MIXCLOUD("Mixcloud", true),
    AUDIOMACK("Audiomack", true),
    PINTEREST("Pinterest", false),
    TUMBLR("Tumblr", false),
    THREADS("Threads", false),
    BLUESKY("Bluesky", false),
    KICK("Kick", false),
    BILIBILI("Bilibili", false),
    VK("VK", false),
    LINKEDIN("LinkedIn", false),
    OTHER("Link", false);

    /** Stable id for settings that remember something per website ("youtube-music"). */
    val key: String get() = name.lowercase().replace('_', '-')

    companion object {
        fun detect(url: String): Platform {
            val host = hostOf(url) ?: return OTHER
            return when {
                host == "music.youtube.com" -> YOUTUBE_MUSIC
                host.endsWith("youtube.com") || host == "youtu.be" -> YOUTUBE
                host.endsWith("tiktok.com") -> TIKTOK
                host.endsWith("snapchat.com") -> SNAPCHAT
                host.endsWith("instagram.com") -> INSTAGRAM
                host == "x.com" || host.endsWith(".x.com") || host.endsWith("twitter.com") -> X
                host.endsWith("facebook.com") || host == "fb.watch" -> FACEBOOK
                host.endsWith("reddit.com") || host == "redd.it" || host == "v.redd.it" -> REDDIT
                host.endsWith("soundcloud.com") -> SOUNDCLOUD
                host.endsWith("bandcamp.com") -> BANDCAMP
                host == "open.spotify.com" || host == "spotify.link" || host == "spotify.app.link" -> SPOTIFY
                host.endsWith("vimeo.com") -> VIMEO
                host.endsWith("twitch.tv") -> TWITCH
                host.endsWith("dailymotion.com") || host == "dai.ly" -> DAILYMOTION
                host == "streamable.com" -> STREAMABLE
                host.endsWith("rumble.com") -> RUMBLE
                host.endsWith("mixcloud.com") -> MIXCLOUD
                host.endsWith("audiomack.com") -> AUDIOMACK
                host == "pin.it" || PINTEREST_HOST.matches(host) -> PINTEREST
                host.endsWith("tumblr.com") -> TUMBLR
                host == "threads.net" || host == "threads.com" -> THREADS
                host == "bsky.app" -> BLUESKY
                host == "kick.com" -> KICK
                host.endsWith("bilibili.com") || host == "bilibili.tv" || host == "b23.tv" -> BILIBILI
                host == "vk.com" || host == "vk.ru" || host == "vkvideo.ru" -> VK
                host.endsWith("linkedin.com") -> LINKEDIN
                else -> OTHER
            }
        }

        // pinterest.com, pinterest.co.uk, de.pinterest.com, …
        private val PINTEREST_HOST = Regex("""^([a-z]{2}\.)?pinterest\.[a-z.]{2,6}$""")

        internal fun hostOf(url: String): String? =
            runCatching { URI(url).host?.lowercase()?.removePrefix("www.")?.removePrefix("m.") }.getOrNull()
    }
}

/** Rules about link shapes that do not need the network. */
object LinkRules {
    /** Share links that only redirect to the real page (resolved before analysis). */
    fun isShortLink(url: String): Boolean {
        val uri = runCatching { URI(url) }.getOrNull() ?: return false
        val host = uri.host?.lowercase() ?: return false
        val path = uri.path.orEmpty()
        return host == "vm.tiktok.com" || host == "vt.tiktok.com" ||
            (host.endsWith("tiktok.com") && path.startsWith("/t/")) ||
            (host.endsWith("snapchat.com") && path.startsWith("/t/")) ||
            host == "on.soundcloud.com" || host == "spotify.link" || host == "spotify.app.link" || host == "fb.watch" ||
            host == "pin.it" || host == "b23.tv" || host == "t.co" || host == "search.app" ||
            (host.endsWith("reddit.com") && Regex("^/r/[^/]+/s/").containsMatchIn(path))
    }

    /**
     * Where an app-redirect really points. Spotify and others answer a phone
     * with "open the app" links (intent://…, spotify.app.link/?$full_url=…)
     * that carry the web page inside them. Returns that https link, or null.
     */
    fun appLinkTarget(location: String): String? {
        val decoded = runCatching { java.net.URLDecoder.decode(location, "UTF-8") }.getOrDefault(location)
        return APP_LINK_PARAMS.firstNotNullOfOrNull { param ->
            Regex("""(?:[?&;#]|^)${Regex.escape(param)}=(https://[^&;#\s]+)""").find(decoded)?.groupValues?.get(1)
        }?.takeIf { target -> Platform.hostOf(target)?.let { it.contains('.') && it != "play.google.com" } == true }
    }

    private val APP_LINK_PARAMS = listOf("\$full_url", "\$fallback_url", "\$desktop_url", "S.browser_fallback_url", "url", "link")

    /** The link itself is a whole playlist or album. */
    fun isPlaylistLink(url: String): Boolean {
        val path = runCatching { URI(url).path }.getOrNull().orEmpty()
        return when (Platform.detect(url)) {
            Platform.YOUTUBE, Platform.YOUTUBE_MUSIC -> path == "/playlist" || path.startsWith("/browse/")
            Platform.SOUNDCLOUD -> path.contains("/sets/")
            Platform.BANDCAMP -> path.startsWith("/album/")
            Platform.SPOTIFY -> path.contains("/album/") || path.contains("/playlist/")
            Platform.AUDIOMACK -> path.contains("/album/") || path.contains("/playlist/")
            Platform.MIXCLOUD -> path.contains("/playlists/")
            else -> false
        }
    }

    /** A YouTube video opened from a playlist ("…&list=…"): offer "whole playlist". */
    fun hasPlaylistParam(url: String): Boolean {
        val platform = Platform.detect(url)
        if (platform != Platform.YOUTUBE && platform != Platform.YOUTUBE_MUSIC) return false
        val query = runCatching { URI(url).rawQuery }.getOrNull().orEmpty()
        return query.split('&').any { it.startsWith("list=") && it.length > 5 }
    }

    /** Snapchat: only public Spotlight / story links can work. */
    fun isSnapchatPublic(url: String): Boolean {
        val path = runCatching { URI(url).path }.getOrNull().orEmpty()
        return path.startsWith("/spotlight/") || path.startsWith("/add/") || path.startsWith("/p/") ||
            Platform.hostOf(url) == "story.snapchat.com"
    }

    fun isTikTokSlideshow(url: String): Boolean =
        Platform.detect(url) == Platform.TIKTOK && runCatching { URI(url).path }.getOrNull().orEmpty().contains("/photo/")
}
