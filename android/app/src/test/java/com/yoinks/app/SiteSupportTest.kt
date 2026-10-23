package com.yoinks.app

import com.yoinks.app.domain.link.LinkExtractor
import com.yoinks.app.domain.model.LinkRules
import com.yoinks.app.domain.model.Platform
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Spotify and SoundCloud share links, and the extra sites Yoinks knows by name. */
class SiteSupportTest {
    @Test fun spotifyAppRedirectsCarryTheWebPage() {
        // What spotify.link answers a phone with: an Android intent with a web fallback.
        val intent = "intent://open?link_click_id=1#Intent;scheme=spotify;package=com.spotify.music;" +
            "S.browser_fallback_url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F4cOdK2wGLETKBW3PvgPWqT;end"
        assertEquals("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT", LinkRules.appLinkTarget(intent))
        // What open.spotify.com sends a phone to.
        val branch = "https://spotify.app.link/?product=open&%24full_url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F4cOdK2wGLETKBW3PvgPWqT%3Fsi%3Dabc&feature=organic"
        assertEquals("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc", LinkRules.appLinkTarget(branch))
        // A store link is not a page to download.
        assertNull(LinkRules.appLinkTarget("intent://x#Intent;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore;end"))
        assertNull(LinkRules.appLinkTarget("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"))
    }

    @Test fun shareLinksThatNeedResolving() {
        listOf(
            "https://spotify.link/aB3cD4eF5g", "https://spotify.app.link/x", "https://on.soundcloud.com/AbC123",
            "https://pin.it/1a2b3c", "https://b23.tv/AbCd", "https://t.co/xyz", "https://search.app/AbC",
        ).forEach { assertTrue(it, LinkRules.isShortLink(it)) }
        assertFalse(LinkRules.isShortLink("https://soundcloud.com/artist/track"))
        assertEquals("https://spotify.link/aB3cD4eF5g", LinkExtractor.first("Listen on Spotify: spotify.link/aB3cD4eF5g"))
    }

    @Test fun moreSitesAreKnownByName() {
        mapOf(
            "https://m.soundcloud.com/artist/track" to Platform.SOUNDCLOUD,
            "https://spotify.app.link/x" to Platform.SPOTIFY,
            "https://www.mixcloud.com/dj/mix/" to Platform.MIXCLOUD,
            "https://audiomack.com/artist/song/title" to Platform.AUDIOMACK,
            "https://pin.it/1a2b3c" to Platform.PINTEREST,
            "https://de.pinterest.com/pin/123/" to Platform.PINTEREST,
            "https://www.pinterest.co.uk/pin/123/" to Platform.PINTEREST,
            "https://someone.tumblr.com/post/1" to Platform.TUMBLR,
            "https://www.threads.net/@a/post/x" to Platform.THREADS,
            "https://bsky.app/profile/a/post/x" to Platform.BLUESKY,
            "https://kick.com/a/videos/1" to Platform.KICK,
            "https://www.bilibili.com/video/BV1" to Platform.BILIBILI,
            "https://b23.tv/AbCd" to Platform.BILIBILI,
            "https://vk.com/video-1_2" to Platform.VK,
            "https://www.linkedin.com/posts/x" to Platform.LINKEDIN,
            "https://example.com/video" to Platform.OTHER,
        ).forEach { (url, platform) -> assertEquals(url, platform, Platform.detect(url)) }
        assertTrue(Platform.MIXCLOUD.isMusic && Platform.AUDIOMACK.isMusic)
        assertTrue(LinkRules.isPlaylistLink("https://audiomack.com/artist/album/name"))
    }
}
